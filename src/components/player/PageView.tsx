import type { Page } from "../../../shared/character.ts";
import { diceLabel, PAGE_TYPES } from "../EquipmentEditor.tsx";
import { Overlay } from "./Overlay.tsx";
import { TYPE_ICONS } from "./PageCard.tsx";

/** The enlarged Page: everything on it. Opening it never selects or plays the Page. */
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
      <div className="page-view">
        <div className="pv-art">{page.image ? <img src={page.image} alt="" /> : <span className="pc-icon big">{TYPE_ICONS[page.type]}</span>}</div>
        <div className="pv-meta">
          <span className="pc-cost">{page.cost}</span>
          <span>
            {page.cost} Light · {page.kind === "special" ? "Special" : "Basic"} · {type}
          </span>
        </div>
        <h3>Dice (top to bottom)</h3>
        <ol className="pv-dice">
          {page.dice.map((d) => (
            <li key={d.id} className={`pc-die ${d.kind}${d.counter ? " counter" : ""}`}>
              {diceLabel(d)}
            </li>
          ))}
          {page.dice.length === 0 && <li className="muted">No dice</li>}
        </ol>
        {page.effect && (
          <>
            <h3>Effect</h3>
            <p className="pv-effect">{page.effect}</p>
          </>
        )}
        <div className="row">
          {action && (
            <button type="button" className="big-button" disabled={action.disabled} onClick={action.run}>
              {action.label}
            </button>
          )}
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Overlay>
  );
}
