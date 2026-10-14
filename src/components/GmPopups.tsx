import { useEffect, useState } from "react";
import type { Character, ItemTemplate } from "../../shared/character.ts";
import { ANY_STAT, finishedPopups, POPUP_STATS, POPUP_TEXT_MAX, POPUP_TITLE_MAX, popupIsUp, popupWaitingOn, statLabel, upPopups } from "../../shared/popups.ts";
import type { PlayerListEntry } from "../../shared/players.ts";
import { dealSummary, MAX_AHN, MAX_DEAL_COUNT, OUTCOME_LABELS } from "../../shared/rewards.ts";
import type { GmPopup, PopupDeal, TableAction, TableState } from "../../shared/types.ts";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { NumberInput } from "./Fields.tsx";
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
  /** "": hands out nothing (Game setting "Rewards and costs in popups"). */
  dealKind: "" | PopupDeal["kind"];
  itemId: string;
  count: number;
  ahn: number;
  when: PopupDeal["when"];
  need: number;
  price: number;
}

export const BLANK_DRAFT: PopupDraft = { title: "", text: "", stat: "", everyone: true, picked: [], dealKind: "", itemId: "", count: 1, ahn: 0, when: "now", need: 10, price: 10 };

/** What the Popups menu needs when the Game setting "Rewards and costs in popups" is on. */
export interface RewardsData {
  /** The item library (undefined while loading). */
  library: Record<string, ItemTemplate> | undefined;
  /** Players' characters, by user id, for their Ahn. */
  characters: Record<string, Character> | undefined;
}

function draftDeal(d: PopupDraft): PopupDeal | undefined {
  if (!d.dealKind) return undefined;
  const when = d.dealKind === "cost" && d.when === "buy" ? "now" : d.when;
  return {
    kind: d.dealKind,
    when,
    ...(d.itemId ? { itemId: d.itemId, count: d.count } : {}),
    ...(d.ahn > 0 ? { ahn: d.ahn } : {}),
    ...(when === "roll" ? { need: d.need } : {}),
    ...(when === "buy" ? { price: d.price } : {}),
  };
}

/**
 * The GM's popups to players, in a toolbar menu: write one (any mix of text, an image and a Story
 * Roll prompt), pick who gets it, send it. Below, the ones still up, with who closed them and what
 * each player rolled; then, folded away, the finished ones (closed by everyone or taken down) with
 * their results, until the GM clears them.
 */
export function GmPopups({
  gameId,
  table,
  players,
  act,
  draft,
  setDraft,
  rewards,
}: {
  gameId: string;
  table: TableState;
  players: PlayerListEntry[];
  act: (action: TableAction) => boolean;
  /** Kept by the GM screen, so closing the menu doesn't lose a half-written popup. */
  draft: PopupDraft;
  setDraft: (d: PopupDraft) => void;
  /** Set when the GM turned on "Rewards and costs in popups" in Game settings. */
  rewards?: RewardsData;
}) {
  const { title, text, image, stat, everyone, picked } = draft;
  const set = (patch: Partial<PopupDraft>) => (setDraft({ ...draft, ...patch }), setSent(false));
  const [sent, setSent] = useState(false);
  const deal = rewards ? draftDeal(draft) : undefined;
  const dealProblem = !deal
    ? ""
    : !deal.itemId && !deal.ahn
      ? "Pick an item or an amount of Ahn."
      : deal.when === "roll" && !stat
        ? "Pick a Story Roll above for the roll to beat."
        : "";
  const empty = !title.trim() && !text.trim() && !image && !stat && !deal;
  const noOne = !everyone && picked.length === 0;
  const name = (uid: string) => {
    const p = players.find((x) => x.uid === uid);
    return p?.character?.name ?? p?.username ?? "Someone who left";
  };

  const send = () => {
    const ok = act({ type: "sendPopup", title, text, image, roll: stat ? { stat } : undefined, to: everyone ? undefined : picked, ...(deal ? { deal } : {}) });
    if (!ok) return;
    setDraft({ ...BLANK_DRAFT, everyone, picked });
    setSent(true);
  };

  const popups = upPopups(table).reverse();
  const finished = finishedPopups(table);
  const uids = players.map((p) => p.uid);
  return (
    <div className="gm-popups">
      <p className="muted small">Shows on players' phones until they close it, then takes itself down. Use any mix of text, an image and a Story Roll.</p>
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
      {rewards && <DealFields draft={draft} set={set} library={rewards.library} problem={dealProblem} />}
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
      <button className="big-button" disabled={empty || noOne || !!dealProblem} onClick={send}>
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
              <SentPopup key={p.id} popup={p} players={uids} name={name} onRemove={() => act({ type: "removePopup", popupId: p.id })} />
            ))}
          </ul>
        </>
      )}

      {finished.length > 0 && (
        <details className="popup-finished">
          <summary>
            Finished <span className="muted small">({finished.length})</span>
          </summary>
          <ul className="plain popup-sent">
            {finished.map((p) => (
              <SentPopup key={p.id} popup={p} players={uids} name={name} onRemove={() => act({ type: "clearPopups", popupId: p.id })} />
            ))}
          </ul>
          <button type="button" className="small" onClick={() => act({ type: "clearPopups" })}>
            Clear finished
          </button>
        </details>
      )}

      {rewards && <PartyAhn players={players} characters={rewards.characters} act={act} />}
    </div>
  );
}

/** The reward or cost part of a popup: an item and/or Ahn, and how the player gets (or loses) it. */
function DealFields({
  draft,
  set,
  library,
  problem,
}: {
  draft: PopupDraft;
  set: (patch: Partial<PopupDraft>) => void;
  library: Record<string, ItemTemplate> | undefined;
  problem: string;
}) {
  const { dealKind, itemId, count, ahn, when, need, price } = draft;
  const items = Object.entries(library ?? {})
    .filter(([, t]) => t.pending !== true)
    .sort((a, b) => a[1].name.localeCompare(b[1].name));
  const cost = dealKind === "cost";
  return (
    <fieldset className="popup-to popup-deal">
      <legend>Reward or cost</legend>
      <div className="deal-kind" role="radiogroup" aria-label="Reward or cost">
        {(
          [
            ["", "None"],
            ["reward", "Reward"],
            ["cost", "Cost"],
          ] as const
        ).map(([k, label]) => (
          <label key={k}>
            <input type="radio" name="popup-deal" checked={dealKind === k} onChange={() => set({ dealKind: k, ...(k === "cost" && when === "buy" ? { when: "now" } : {}) })} /> {label}
          </label>
        ))}
      </div>
      {dealKind && (
        <>
          <div className="deal-row">
            <label className="field">
              <span>Item</span>
              <select value={itemId} onChange={(e) => set({ itemId: e.target.value })}>
                <option value="">{library === undefined ? "Loading…" : items.length ? "No item" : "No items in the library yet"}</option>
                {items.map(([id, t]) => (
                  <option key={id} value={id}>
                    {t.name || "Unnamed item"}
                  </option>
                ))}
              </select>
            </label>
            {itemId && (
              <label className="field deal-num">
                <span>How many</span>
                <NumberInput label="How many" value={count} min={1} max={MAX_DEAL_COUNT} onChange={(n) => set({ count: Math.min(MAX_DEAL_COUNT, Math.max(1, Math.round(n))) })} />
              </label>
            )}
            <label className="field deal-num">
              <span>Ahn</span>
              <NumberInput label="Ahn" value={ahn} min={0} max={MAX_AHN} onChange={(n) => set({ ahn: Math.min(MAX_AHN, Math.max(0, Math.round(n))) })} />
            </label>
          </div>
          <div className="deal-when">
            <label>
              <input type="radio" name="popup-when" checked={when === "now"} onChange={() => set({ when: "now" })} /> {cost ? "Take it when sent" : "Give it when sent"}
            </label>
            <label>
              <input type="radio" name="popup-when" checked={when === "roll"} onChange={() => set({ when: "roll" })} /> {cost ? "Lose it on a Story Roll under" : "Get it on a Story Roll of at least"}
              <NumberInput label="Roll to beat" value={need} min={1} max={99} onChange={(n) => set({ when: "roll", need: Math.min(99, Math.max(1, Math.round(n))) })} />
            </label>
            {!cost && (
              <label>
                <input type="radio" name="popup-when" checked={when === "buy"} onChange={() => set({ when: "buy" })} /> Player buys it for
                <NumberInput label="Price in Ahn" value={price} min={1} max={MAX_AHN} onChange={(n) => set({ when: "buy", price: Math.min(MAX_AHN, Math.max(1, Math.round(n))) })} /> Ahn
              </label>
            )}
          </div>
          {problem && <p className="muted small">{problem}</p>}
        </>
      )}
    </fieldset>
  );
}

/** A player's Ahn: saved when the GM leaves the box or presses Enter, not on every keystroke. */
function AhnField({ label, value, onSet }: { label: string; value: number; onSet: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(n)) return setDraft(String(value));
    const next = Math.min(MAX_AHN, Math.max(0, Math.round(n)));
    setDraft(String(next));
    if (next !== value) onSet(next);
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      className="ahn-field"
      aria-label={label}
      min={0}
      max={MAX_AHN}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
    />
  );
}

/** Each player's Ahn, to set by hand. Changes save to their character sheet. */
function PartyAhn({ players, characters, act }: { players: PlayerListEntry[]; characters: Record<string, Character> | undefined; act: (action: TableAction) => boolean }) {
  return (
    <>
      <h3>Party Ahn</h3>
      <ul className="plain party-ahn" aria-label="Party Ahn">
        {players.length === 0 && <li className="muted small">No players yet.</li>}
        {players.map((p) => {
          const c = characters?.[p.uid];
          return (
            <li key={p.uid} className="row-between">
              <span>
                {p.character?.name ?? p.username}
                {p.character && <span className="muted small"> ({p.username})</span>}
              </span>
              {c ? (
                <AhnField label={`${p.character?.name ?? p.username}'s Ahn`} value={c.ahn ?? 0} onSet={(n) => act({ type: "setAhn", uid: p.uid, ahn: n })} />
              ) : (
                <span className="muted small">No character yet</span>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** A deal in a few words, e.g. "Reward: Sword on 12+". */
function dealLine(d: PopupDeal): string {
  const how = d.when === "roll" ? ` on ${d.need}+` : d.when === "buy" ? ` for ${d.price} Ahn` : "";
  return `${d.kind === "cost" ? "Cost" : "Reward"}: ${dealSummary(d)}${how}`;
}

/** A popup in the GM's list: still up (with who it waits on) or finished (with how it came down). */
function SentPopup({ popup: p, players, name, onRemove }: { popup: GmPopup; players: string[]; name: (uid: string) => string; onRemove: () => void }) {
  const up = popupIsUp(p);
  const waiting = popupWaitingOn(p, players) ?? [];
  const parts = [p.text && "text", p.image && "image", p.roll && `${statLabel(p.roll.stat)} roll`, p.deal && dealLine(p.deal)].filter(Boolean).join(" · ");
  const outcomes = Object.entries(p.outcomes ?? {});
  const status = up
    ? waiting.length
      ? `Still open for ${waiting.map(name).join(", ")}`
      : "Everyone closed it"
    : p.takenDown
      ? `Taken down${waiting.length ? ` while open for ${waiting.map(name).join(", ")}` : ""}`
      : "Everyone closed it, so it took itself down";
  return (
    <li className={`popup-sent-item${up ? "" : " done"}`}>
      <div className="row-between">
        <strong className="popup-sent-title">{p.title || p.text || (p.image ? "Image" : "Story Roll")}</strong>
        {up ? (
          <ConfirmButton className="small" confirmLabel="Sure?" confirmHint="Takes it off every phone" onConfirm={onRemove}>
            Take down
          </ConfirmButton>
        ) : (
          <button type="button" className="small" onClick={onRemove}>
            Clear
          </button>
        )}
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
      {outcomes.length > 0 && <span className="small">{outcomes.map(([uid, o]) => `${name(uid)} ${OUTCOME_LABELS[o]}`).join(", ")}</span>}
      <span className="muted small">{status}</span>
    </li>
  );
}
