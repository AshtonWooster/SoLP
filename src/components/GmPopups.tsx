import { useState } from "react";
import { ANY_STAT, POPUP_STATS, POPUP_TEXT_MAX, POPUP_TITLE_MAX, popupIsFor, statLabel } from "../../shared/popups.ts";
import type { PlayerListEntry } from "../../shared/players.ts";
import type { GmPopup, TableAction, TableState } from "../../shared/types.ts";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { ImageUpload } from "./ImageUpload.tsx";

/** A popup the GM is writing. */
export interface PopupDraft {
  title: string;
  text: string;
  image?: string;
  /** "": no Story Roll; ANY_STAT: the player picks. */
  stat: string;
  everyone: boolean;
  /** User ids, when not sending to everyone. */
  picked: string[];
}

export const BLANK_DRAFT: PopupDraft = { title: "", text: "", stat: "", everyone: true, picked: [] };

/**
 * The GM's popups to players, in a toolbar menu: write one (any mix of text, an image and a Story
 * Roll prompt), pick who gets it, send it. Below, the ones still up, with who closed them and what
 * each player rolled.
 */
export function GmPopups({
  gameId,
  table,
  players,
  act,
  draft,
  setDraft,
}: {
  gameId: string;
  table: TableState;
  players: PlayerListEntry[];
  act: (action: TableAction) => boolean;
  /** Kept by the GM screen, so closing the menu doesn't lose a half-written popup. */
  draft: PopupDraft;
  setDraft: (d: PopupDraft) => void;
}) {
  const { title, text, image, stat, everyone, picked } = draft;
  const set = (patch: Partial<PopupDraft>) => (setDraft({ ...draft, ...patch }), setSent(false));
  const [sent, setSent] = useState(false);
  const empty = !title.trim() && !text.trim() && !image && !stat;
  const noOne = !everyone && picked.length === 0;
  const name = (uid: string) => {
    const p = players.find((x) => x.uid === uid);
    return p?.character?.name ?? p?.username ?? "Someone who left";
  };

  const send = () => {
    const ok = act({ type: "sendPopup", title, text, image, roll: stat ? { stat } : undefined, to: everyone ? undefined : picked });
    if (!ok) return;
    setDraft({ ...BLANK_DRAFT, everyone, picked });
    setSent(true);
  };

  const popups = [...(table.popups ?? [])].reverse();
  return (
    <div className="gm-popups">
      <p className="muted small">Shows on players' phones until they close it. Use any mix of text, an image and a Story Roll.</p>
      <label className="field">
        <span>Title</span>
        <input value={title} maxLength={POPUP_TITLE_MAX} placeholder="Optional" onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label className="field">
        <span>Text</span>
        <textarea value={text} rows={4} maxLength={POPUP_TEXT_MAX} placeholder="What the players read" onChange={(e) => set({ text: e.target.value })} />
      </label>
      <ImageUpload folder={`games/${gameId}/assets/popups`} kind="popup" shape="page" label="Image" value={image} onChange={(url) => set({ image: url })} />
      <label className="field">
        <span>Story Roll</span>
        <select value={stat} onChange={(e) => set({ stat: e.target.value })}>
          <option value="">None</option>
          <option value={ANY_STAT}>Player picks the Stat</option>
          {POPUP_STATS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="popup-to">
        <legend>Send to</legend>
        <label>
          <input type="radio" name="popup-to" checked={everyone} onChange={() => set({ everyone: true })} /> Every player
        </label>
        <label>
          <input type="radio" name="popup-to" checked={!everyone} onChange={() => set({ everyone: false })} /> Pick players
        </label>
        {!everyone && (
          <ul className="pick-list">
            {players.length === 0 && <li className="muted small">No players yet.</li>}
            {players.map((p) => (
              <li key={p.uid}>
                <label>
                  <input
                    type="checkbox"
                    checked={picked.includes(p.uid)}
                    onChange={(e) => {
                      set({ picked: e.target.checked ? [...picked, p.uid] : picked.filter((x) => x !== p.uid) });
                    }}
                  />
                  {p.character?.name ?? p.username}
                  {p.character && <span className="muted small">({p.username})</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      <button className="big-button" disabled={empty || noOne} onClick={send}>
        Show popup
      </button>
      {sent && (
        <p className="small" role="status">
          Sent.
        </p>
      )}

      {popups.length > 0 && (
        <>
          <h3>Up now</h3>
          <ul className="plain popup-sent">
            {popups.map((p) => (
              <SentPopup key={p.id} popup={p} players={players} name={name} onRemove={() => act({ type: "removePopup", popupId: p.id })} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function SentPopup({ popup: p, players, name, onRemove }: { popup: GmPopup; players: PlayerListEntry[]; name: (uid: string) => string; onRemove: () => void }) {
  const recipients = p.to?.length ? p.to : players.filter((x) => popupIsFor(p, x.uid)).map((x) => x.uid);
  const open = recipients.filter((uid) => !p.closedBy?.includes(uid));
  const parts = [p.text && "text", p.image && "image", p.roll && `${statLabel(p.roll.stat)} roll`].filter(Boolean).join(" · ");
  return (
    <li className="popup-sent-item">
      <div className="row-between">
        <strong className="popup-sent-title">{p.title || p.text || (p.image ? "Image" : "Story Roll")}</strong>
        <ConfirmButton className="small" confirmLabel="Take down?" onConfirm={onRemove}>
          Take down
        </ConfirmButton>
      </div>
      <span className="muted small">
        {parts} · To {p.to?.length ? p.to.map(name).join(", ") : "every player"}
      </span>
      {p.roll && Object.keys(p.rolls ?? {}).length > 0 && (
        <span className="small">
          Rolled: {Object.entries(p.rolls ?? {})
            .map(([uid, total]) => `${name(uid)} ${total}`)
            .join(", ")}
        </span>
      )}
      <span className="muted small">{open.length ? `Still open for ${open.map(name).join(", ")}` : "Everyone closed it"}</span>
    </li>
  );
}
