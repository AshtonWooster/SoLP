import type { TableState } from "../../shared/types.ts";
import { arrowPages } from "./arrows.ts";
import { Overlay } from "./player/Overlay.tsx";
import { PageDetail } from "./player/PageView.tsx";

/** The Page(s) behind a tapped board arrow: one Page, or both sides of a clash. */
export function SlotPages({ state, slotIds, onClose }: { state: TableState; slotIds: string[]; onClose: () => void }) {
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
            </h3>
            <PageDetail page={page} />
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
