// The live table, hosted in the GM's browser. Phones and the board connect straight to it
// over WebRTC data channels, so gameplay never calls a Cloud Function or writes Firestore
// per action. Firestore is used only to hand over connection details and to autosave.
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  type DocumentChange,
} from "firebase/firestore";
import { ActionError, applyAction, newId, newTable, type Actor } from "../../shared/engine.ts";
import type {
  GameDoc,
  GmNotes,
  HostMessage,
  PeerMessage,
  SessionDoc,
  SignalDoc,
  TableAction,
  TableState,
  View,
} from "../../shared/types.ts";
import { db } from "../firebase.ts";
import { gathered, newPeerConnection, SIGNAL_MAX_AGE_MS } from "./rtc.ts";

export interface HostSnapshot {
  status: "starting" | "hosting" | "replaced" | "error";
  error?: string;
  table?: TableState;
  notes: Record<string, string>;
  /** User ids connected right now, host included. */
  online: string[];
}

interface Peer {
  pc: RTCPeerConnection;
  channel?: RTCDataChannel;
  actor: Actor;
  view?: View;
}

const SAVE_DELAY_MS = 3000;

export class Host {
  private sessionId = newId();
  private table?: TableState;
  private notes: Record<string, string> = {};
  private peers = new Set<Peer>();
  private handled = new Set<string>();
  private unsubs: (() => void)[] = [];
  private saveTimer?: ReturnType<typeof setTimeout>;
  private dirty = false;
  private stopped = false;
  private snapshot: HostSnapshot = { status: "starting", notes: {}, online: [] };
  private listeners = new Set<(s: HostSnapshot) => void>();

  constructor(
    private gameId: string,
    private me: Actor,
    private game: GameDoc,
  ) {}

  /** Keeps the member list current, e.g. when someone joins mid-session. */
  setGame(game: GameDoc) {
    this.game = game;
  }

  subscribe(fn: (s: HostSnapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.snapshot);
    return () => this.listeners.delete(fn);
  }

  async start() {
    try {
      const [tableSnap, notesSnap] = await Promise.all([
        getDoc(doc(db, "games", this.gameId, "table", "state")),
        getDoc(doc(db, "games", this.gameId, "gm", "notes")),
      ]);
      if (this.stopped) return;
      this.table = (tableSnap.data() as TableState | undefined) ?? newTable();
      this.notes = (notesSnap.data() as GmNotes | undefined)?.tokens ?? {};

      // Announce this tab as the host. Opening the GM screen elsewhere takes over.
      const session: SessionDoc = { sessionId: this.sessionId, hostUid: this.me.uid, startedAt: Date.now() };
      await setDoc(this.sessionRef(), session);
      if (this.stopped) return;
      this.unsubs.push(
        onSnapshot(this.sessionRef(), (snap) => {
          const s = snap.data() as SessionDoc | undefined;
          if (s && s.sessionId !== this.sessionId && !this.stopped) {
            this.shutdown("Hosting moved to another GM screen.");
            this.update({ status: "replaced" });
          }
        }),
        onSnapshot(
          query(collection(db, "games", this.gameId, "signals"), where("sessionId", "==", this.sessionId)),
          (snap) => snap.docChanges().forEach((c) => this.onSignal(c)),
          (err) => this.update({ status: "error", error: err.message }),
        ),
      );
      this.update({ status: "hosting" });
      this.publish();
    } catch (err) {
      this.update({ status: "error", error: (err as Error).message });
    }
  }

  /** Applies an action made on the GM screen itself. Throws ActionError if not allowed. */
  act(action: TableAction) {
    this.apply(action, this.me);
  }

  /** Saves and stops hosting; connected devices see the table close. */
  async stop() {
    if (this.stopped) return;
    await this.flush();
    this.shutdown("The GM closed the table.");
    // Only clear the session if it's still ours (another tab may have taken over).
    const snap = await getDoc(this.sessionRef()).catch(() => undefined);
    if ((snap?.data() as SessionDoc | undefined)?.sessionId === this.sessionId) {
      await deleteDoc(this.sessionRef()).catch(() => {});
    }
  }

  /** Writes unsaved changes now. */
  async flush() {
    clearTimeout(this.saveTimer);
    if (!this.dirty || !this.table) return;
    this.dirty = false;
    try {
      await Promise.all([
        setDoc(doc(db, "games", this.gameId, "table", "state"), this.table),
        setDoc(doc(db, "games", this.gameId, "gm", "notes"), { tokens: this.notes } satisfies GmNotes),
      ]);
    } catch (err) {
      this.dirty = true;
      console.error("Autosave failed", err);
    }
  }

  // ---- internals ----

  private sessionRef() {
    return doc(db, "games", this.gameId, "session", "host");
  }

  private shutdown(reason: string) {
    this.stopped = true;
    clearTimeout(this.saveTimer);
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    for (const peer of this.peers) {
      this.send(peer, { t: "bye", reason });
      peer.pc.close();
    }
    this.peers.clear();
  }

  private update(patch: Partial<HostSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((fn) => fn(this.snapshot));
  }

  /** A device wrote a connection request: answer it and wait for its data channel. */
  private async onSignal(change: DocumentChange) {
    const id = change.doc.id;
    const signal = change.doc.data() as SignalDoc;
    if (change.type !== "added" || this.handled.has(id) || signal.answer) return;
    this.handled.add(id);
    const member = this.game.members[signal.uid];
    if (!member || Date.now() - signal.createdAt > SIGNAL_MAX_AGE_MS) {
      deleteDoc(change.doc.ref).catch(() => {});
      return;
    }
    const peer: Peer = {
      pc: newPeerConnection(),
      actor: { uid: signal.uid, role: member.role, displayName: member.displayName },
    };
    this.peers.add(peer);
    peer.pc.ondatachannel = (e) => this.attach(peer, e.channel);
    peer.pc.onconnectionstatechange = () => {
      if (peer.pc.connectionState === "failed" || peer.pc.connectionState === "closed") this.drop(peer);
    };
    try {
      await peer.pc.setRemoteDescription({ type: "offer", sdp: signal.offer });
      await peer.pc.setLocalDescription(await peer.pc.createAnswer());
      await gathered(peer.pc);
      if (this.stopped) return;
      await updateDoc(change.doc.ref, { answer: peer.pc.localDescription!.sdp });
    } catch (err) {
      console.warn("Couldn't answer a connection request", err);
      this.drop(peer);
    }
  }

  private attach(peer: Peer, channel: RTCDataChannel) {
    peer.channel = channel;
    channel.onclose = () => this.drop(peer);
    channel.onmessage = (e) => {
      let msg: PeerMessage;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (msg.t === "hello") this.onHello(peer, msg.view);
      else if (msg.t === "act" && peer.view) {
        try {
          this.apply(msg.action, peer.actor);
          this.send(peer, { t: "ack", id: msg.id });
        } catch (err) {
          const error = err instanceof ActionError ? err.message : "Something went wrong.";
          this.send(peer, { t: "ack", id: msg.id, error });
        }
      }
    };
  }

  private onHello(peer: Peer, view: View) {
    if (view === "board" && peer.actor.role !== "gm") return this.refuse(peer, "Only the GM can open this screen.");
    if (view === "play" && peer.actor.role === "gm") {
      return this.refuse(peer, "You're the GM of this game. Use the GM screen.");
    }
    peer.view = view;
    // A player's first visit gives them a token.
    if (view === "play") {
      try {
        this.apply({ type: "takeSeat" }, peer.actor);
      } catch {}
    }
    this.publish();
  }

  /** Tells the device why, then hangs up once the message has had time to arrive. */
  private refuse(peer: Peer, reason: string) {
    this.send(peer, { t: "bye", reason });
    setTimeout(() => this.drop(peer), 1000);
  }

  private drop(peer: Peer) {
    if (!this.peers.delete(peer)) return;
    peer.pc.close();
    this.publish();
  }

  private apply(action: TableAction, actor: Actor) {
    if (!this.table) throw new ActionError("The table is still loading.");
    let changed: boolean;
    if (action?.type === "setNote") {
      applyAction(this.table, action, actor); // permission check only
      this.notes = { ...this.notes, [action.tokenId]: String(action.note ?? "").slice(0, 2000) };
      changed = true;
    } else {
      changed = applyAction(this.table, action, actor);
    }
    if (changed) {
      this.dirty = true;
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
      this.publish();
    }
  }

  /** Sends the current table to every device (GM-only notes go to GM devices only). */
  private publish() {
    if (!this.table || this.stopped) return;
    const online = [this.me.uid, ...[...this.peers].filter((p) => p.view).map((p) => p.actor.uid)];
    const unique = [...new Set(online)];
    for (const peer of this.peers) {
      if (!peer.view) continue;
      this.send(peer, {
        t: "state",
        table: this.table,
        online: unique,
        notes: peer.actor.role === "gm" ? this.notes : undefined,
      });
    }
    // Hand the GM screen a fresh copy so React sees the change.
    this.update({ table: structuredClone(this.table), notes: this.notes, online: unique });
  }

  private send(peer: Peer, msg: HostMessage) {
    if (peer.channel?.readyState === "open") peer.channel.send(JSON.stringify(msg));
  }
}
