import type { Page } from "../../../shared/character.ts";
import { PAGE_TYPES } from "../EquipmentEditor.tsx";
import { DiceIcon, DIE_NAMES, dieClass, dieRange } from "./DiceIcon.tsx";
import { Overlay } from "./Overlay.tsx";
import { TYPE_ICONS } from "./PageCard.tsx";

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
  const type = PAGE_TYPES.find((t) => t.value === page.type)?.label ?? page.type;
  return (
    <Overlay title={page.name || "Page"} onClose={onClose}>
      <div className={"page-view" + (page.kind === "special" ? " special" : "")}>
        <div className="pv-card">
          <div className="pv-top">
            <span className="pv-cost" aria-label={`${page.cost} Light`}>
              {page.cost}
            </span>
            <span className="pv-type" title={type}>
              {TYPE_ICONS[page.type]}
            </span>
          </div>
          <div className="pv-name">{page.name || "Unnamed"}</div>
          <div className="pv-art">{page.image ? <img src={page.image} alt="" /> : <span className="pc-icon big">{TYPE_ICONS[page.type]}</span>}</div>
          <div className="pv-bottom">
            {page.dice.map((d) => (
              <DiceIcon key={d.id} dice={d} size={24} />
            ))}
          </div>
          <div className="pv-kind">
            {page.kind === "special" ? "Special" : "Basic"} · {type} · {page.cost} Light
          </div>
        </div>

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
                </span>
              </li>
            ))}
            {page.dice.length === 0 && <li className="muted">No dice</li>}
          </ul>
        </div>
      </div>
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
