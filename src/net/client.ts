// A board or phone connecting to the table hosted in the GM's browser.
// Finds the host through Firestore once, then talks to it directly over WebRTC.
import { collection, deleteDoc, doc, onSnapshot, setDoc, type DocumentReference } from "firebase/firestore";
import type { HostMessage, PeerMessage, SessionDoc, SignalDoc, TableAction, TableState, View } from "../../shared/types.ts";
import { db } from "../firebase.ts";
import { gathered, newPeerConnection } from "./rtc.ts";

export interface ClientSnapshot {
  /**
   * waiting: no GM screen is open. connecting: reaching the GM's screen.
   * unreachable: the GM screen didn't answer (retrying). closed: the host turned this device away.
   */
  status: "waiting" | "connecting" | "connected" | "unreachable" | "closed";
  message?: string;
  table?: TableState;
  online: string[];
  notes?: Record<string, string>;
}

const CONNECT_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 3000;

interface Attempt {
  sessionId: string;
  pc: RTCPeerConnection;
  channel: RTCDataChannel;
  signalRef?: DocumentReference;
  cleanup: (() => void)[];
}

export class Client {
  private session?: SessionDoc;
  private attempt?: Attempt;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private nextId = 1;
  private pending = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();
  private snapshot: ClientSnapshot = { status: "connecting", online: [] };
  private listeners = new Set<(s: ClientSnapshot) => void>();
  private unsubSession?: () => void;

  constructor(
    private gameId: string,
    private uid: string,
    private view: View,
  ) {}

  subscribe(fn: (s: ClientSnapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.snapshot);
    return () => this.listeners.delete(fn);
  }

  start() {
    // Reconnect whenever the GM opens (or reopens) their screen.
    this.unsubSession = onSnapshot(
      doc(db, "games", this.gameId, "session", "host"),
      (snap) => {
        const session = snap.data() as SessionDoc | undefined;
        this.session = session;
        if (!session) {
          this.closeAttempt();
          if (this.snapshot.status !== "closed") this.update({ status: "waiting", message: undefined });
        } else if (session.sessionId !== this.attempt?.sessionId && this.snapshot.status !== "closed") {
          this.connect();
        }
      },
      (err) => this.update({ status: "closed", message: err.code === "permission-denied" ? "You're not in this game." : err.message }),
    );
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.unsubSession?.();
    this.closeAttempt();
  }

  /** Sends an action to the host. Resolves when applied; rejects with the host's reason if refused. */
  act(action: TableAction): Promise<void> {
    const channel = this.attempt?.channel;
    if (!channel || channel.readyState !== "open") return Promise.reject(new Error("Not connected to the GM."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      channel.send(JSON.stringify({ t: "act", id, action } satisfies PeerMessage));
    });
  }

  // ---- internals ----

  private update(patch: Partial<ClientSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((fn) => fn(this.snapshot));
  }

  private async connect() {
    const session = this.session;
    if (!session || this.stopped) return;
    clearTimeout(this.retryTimer);
    this.closeAttempt();
    this.update({ status: "connecting", message: undefined });

    const pc = newPeerConnection();
    const channel = pc.createDataChannel("table", { ordered: true });
    const attempt: Attempt = { sessionId: session.sessionId, pc, channel, cleanup: [] };
    this.attempt = attempt;
    const current = () => this.attempt === attempt && !this.stopped;
    const fail = () => {
      if (!current()) return;
      this.closeAttempt();
      this.update({ status: "unreachable", message: "Can't reach the GM's screen. Retrying…" });
      this.retryTimer = setTimeout(() => this.connect(), RETRY_DELAY_MS);
    };

    const timeout = setTimeout(fail, CONNECT_TIMEOUT_MS);
    attempt.cleanup.push(() => clearTimeout(timeout));

    channel.onopen = () => {
      if (!current()) return;
      clearTimeout(timeout);
      if (attempt.signalRef) deleteDoc(attempt.signalRef).catch(() => {});
      channel.send(JSON.stringify({ t: "hello", view: this.view } satisfies PeerMessage));
    };
    channel.onclose = fail;
    // Ignore anything still arriving from an older connection, e.g. the previous host's goodbye.
    channel.onmessage = (e) => current() && this.onMessage(JSON.parse(String(e.data)) as HostMessage);
    pc.onconnectionstatechange = () => pc.connectionState === "failed" && fail();

    try {
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      if (!current()) return;
      const ref = doc(collection(db, "games", this.gameId, "signals"));
      attempt.signalRef = ref;
      const signal: SignalDoc = {
        uid: this.uid,
        sessionId: session.sessionId,
        offer: pc.localDescription!.sdp,
        createdAt: Date.now(),
      };
      await setDoc(ref, signal);
      attempt.cleanup.push(
        onSnapshot(ref, async (snap) => {
          const answer = (snap.data() as SignalDoc | undefined)?.answer;
          if (answer && current() && !pc.remoteDescription) {
            await pc.setRemoteDescription({ type: "answer", sdp: answer }).catch(fail);
          }
        }),
      );
    } catch (err) {
      console.warn("Connection attempt failed", err);
      fail();
    }
  }

  private onMessage(msg: HostMessage) {
    if (msg.t === "state") {
      this.update({ status: "connected", message: undefined, table: msg.table, online: msg.online, notes: msg.notes });
    } else if (msg.t === "ack") {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) p?.reject(new Error(msg.error));
      else p?.resolve();
    } else if (msg.t === "bye") {
      // A refusal (wrong screen) is final; a closed table waits for the GM to reopen.
      const final = !msg.reason.startsWith("The GM closed") && !msg.reason.startsWith("Hosting moved");
      this.closeAttempt();
      this.update(final ? { status: "closed", message: msg.reason } : { status: "waiting", message: msg.reason });
    }
  }

  private closeAttempt() {
    const a = this.attempt;
    if (!a) return;
    this.attempt = undefined;
    a.cleanup.forEach((c) => c());
    a.channel.onclose = null;
    a.channel.onmessage = null;
    a.pc.close();
    if (a.signalRef) deleteDoc(a.signalRef).catch(() => {});
    for (const p of this.pending.values()) p.reject(new Error("Disconnected from the GM."));
    this.pending.clear();
  }
}
