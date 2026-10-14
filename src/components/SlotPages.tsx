import type { Page } from "../../shared/character.ts";
import { PARTIAL_COVER } from "../../shared/ruleset.ts";
import type { Cover, SlottedPage, TableAction, TableState } from "../../shared/types.ts";
import { arrowPages } from "./arrows.ts";
import { Overlay } from "./player/Overlay.tsx";
import { PageDetail } from "./player/PageView.tsx";

/** Who is looking at a slotted Page, so the GM can mark Cover and the Page's owner can answer Full Cover. */
export interface SlotControls {
  isGm: boolean;
  uid?: string;
  act: (a: TableAction) => void;
}

const COVER_OPTIONS: { value: Cover | null; label: string; hint: string }[] = [
  { value: null, label: "No cover", hint: "" },
  { value: "partial", label: "Partial cover", hint: `Final Power -${PARTIAL_COVER}` },
  { value: "full", label: "Full cover", hint: "Fire now or hold fire" },
];

/** On a Ranged Page: the GM marks its target's Cover; with Full Cover, its owner fires now or holds fire. */
export function CoverControls({ state, slot, page, controls }: { state: TableState; slot: SlottedPage; page: Page; controls: SlotControls }) {
  if (page.type !== "ranged") return null;
  const owner = state.tokens[slot.ownerId];
  const target = state.tokens[slot.targets[0]?.tokenId]?.name ?? "The target";
  // The GM can answer for anyone (and does for their own characters); a player answers for their own.
  const decides = controls.isGm || (!!owner?.ownerId && owner.ownerId === controls.uid);
  return (
    <div className="cover-controls">
      {controls.isGm && (
        <div className="cover-pick" role="group" aria-label={`${target}'s cover`}>
          <span className="muted small">{target}'s cover</span>
          {COVER_OPTIONS.map((o) => (
            <button
              key={o.label}
              type="button"
              className={"chip" + ((slot.cover ?? null) === o.value ? " active" : "")}
              aria-pressed={(slot.cover ?? null) === o.value}
              title={o.hint || undefined}
              onClick={() => controls.act({ type: "setCover", slotId: slot.id, cover: o.value })}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      {slot.cover === "partial" && <p className="muted small cover-note">{target} is in Partial Cover: this Page's dice get Final Power -{PARTIAL_COVER} (not below 1).</p>}
      {slot.cover === "full" && <FullCoverChoice slot={slot} page={page} target={target} owner={owner?.name ?? "Its owner"} decides={decides} act={controls.act} />}
    </div>
  );
}

/** Fire the Ranged Page right away, or hold fire and Negate it. */
export function FullCoverChoice({ slot, page, target, owner, decides, act }: { slot: SlottedPage; page: Page; target: string; owner: string; decides: boolean; act: (a: TableAction) => void }) {
  return (
    <div className="full-cover" role="group" aria-label="Full Cover">
      <p className="small">
        <strong>{target} is moving into Full Cover.</strong>{" "}
        {decides ? `Fire ${page.name || "this Page"} now, or hold fire?` : `${owner} can fire now or hold fire.`} Holding fire Negates the Page: only its Defensive Dice
        are kept, as Counter Dice.
      </p>
      {decides && (
        <div className="row">
          <button type="button" className="chip go" onClick={() => act({ type: "coverChoice", slotId: slot.id, fire: true })}>
            Fire now
          </button>
          <button type="button" onClick={() => act({ type: "coverChoice", slotId: slot.id, fire: false })}>
            Hold fire
          </button>
        </div>
      )}
    </div>
  );
}

/** The Page(s) behind a tapped board arrow: one Page, or both sides of a clash. */
export function SlotPages({ state, slotIds, onClose, controls }: { state: TableState; slotIds: string[]; onClose: () => void; controls?: SlotControls }) {
  const shown = arrowPages(state, slotIds);
  const clash = shown.length > 1;
  const name = (id: string) => state.tokens[id]?.name ?? "Someone";
  const title = clash ? `${name(shown[0].slot.ownerId)} vs ${name(shown[1].slot.ownerId)}` : shown[0] ? `${name(shown[0].slot.ownerId)}'s Page` : "Page";
  return (
    <Overlay title={title} onClose={onClose}>
      {shown.length === 0 && <p className="muted">This Page is no longer slotted.</p>}
      <div className={"slot-pages" + (clash ? " clash" : "")}>
        {shown.map(({ slot, page }, i) => (
          <section key={slot.id} className="slot-page">
            {clash && i > 0 && <div className="slot-vs">VS</div>}
            <h3 className="slot-page-head">
              {name(slot.ownerId)}: {page.name || "Unnamed Page"}
              <span className="muted small"> → {slot.targets.map((t) => name(t.tokenId)).join(", ") || "no target"}</span>
              {slot.ammo && <span className="muted small"> · {slot.ammo}</span>}
            </h3>
            <PageDetail page={page} />
            {controls && <CoverControls state={state} slot={slot} page={page} controls={controls} />}
          </section>
        ))}
      </div>
      <div className="row pv-actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Overlay>
  );
}
