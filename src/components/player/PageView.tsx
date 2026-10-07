import type { Page } from "../../../shared/character.ts";
import { DieEffectNames } from "../effects/library.tsx";
import { DiceIcon, DIE_NAMES, dieClass, dieRange } from "./DiceIcon.tsx";
import { PvCard } from "./LorCard.tsx";
import { Overlay } from "./Overlay.tsx";

/**
 * The enlarged Page, laid out like Library of Ruina: the card on the left (cost, type, name, art,
 * dice), and on the right each die with its Power range and everything that applies to it.
 * Opening it never selects or plays the Page.
 */
export function PageView({
  page,
  onClose,
  action,
}: {
  page: Page;
  onClose: () => void;
  /** e.g. "Select this Page", when it can be selected from here. */
  action?: { label: string; run: () => void; disabled?: boolean };
}) {
  return (
    <Overlay title={page.name || "Page"} onClose={onClose}>
      <PageDetail page={page} />
      <div className="row pv-actions">
        {action && (
          <button type="button" className="big-button" disabled={action.disabled} onClick={action.run}>
            {action.label}
          </button>
        )}
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Overlay>
  );
}

/** The enlarged Page itself (card and dice), without the popup around it. */
export function PageDetail({ page }: { page: Page }) {
  return (
    <div className={"page-view" + (page.kind === "special" ? " special" : "")}>
      <PvCard page={page} />

      <div className="pv-detail">
        {page.effect && <p className="pv-page-effect">{page.effect}</p>}
        <ul className="pv-dice-list">
          {page.dice.map((d) => (
            <li key={d.id} className={dieClass(d.kind)}>
              <DiceIcon dice={d} size={30} />
              <span className="pv-range" title={`1d${d.sides}${d.basePower >= 0 ? "+" : ""}${d.basePower}`}>
                {dieRange(d)}
              </span>
              <span className="pv-die-text">
                {d.counter && <span className="pv-counter">Counter {DIE_NAMES[d.kind]}. </span>}
                {d.effect}
                <DieEffectNames dice={d} />
              </span>
            </li>
          ))}
          {page.dice.length === 0 && <li className="muted">No dice</li>}
        </ul>
      </div>
    </div>
  );
}
