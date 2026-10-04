import type { Page } from "../../../shared/character.ts";
import { diceLabel, PAGE_TYPES } from "../EquipmentEditor.tsx";

export const TYPE_ICONS: Record<Page["type"], string> = {
  melee: "⚔",
  ranged: "➶",
  massSummation: "✸",
  massIndividual: "✸",
  instant: "⚡",
};

/** A Page as a card: art (or a type icon), Light cost, name, dice and effect. */
export function PageCard({
  page,
  selected,
  dim,
  onClick,
  size = "hand",
}: {
  page: Page;
  selected?: boolean;
  /** Can't be used right now (e.g. not enough Light). */
  dim?: boolean;
  onClick?: () => void;
  size?: "hand" | "small";
}) {
  const type = PAGE_TYPES.find((t) => t.value === page.type)?.label ?? page.type;
  return (
    <button
      type="button"
      className={`page-card-ui ${size}` + (selected ? " selected" : "") + (dim ? " dim" : "") + (page.kind === "special" ? " special" : "")}
      onClick={onClick}
      aria-label={`${page.name || "Page"}, ${page.cost} Light`}
    >
      <span className="pc-cost">{page.cost}</span>
      <span className="pc-art">{page.image ? <img src={page.image} alt="" /> : <span className="pc-icon">{TYPE_ICONS[page.type]}</span>}</span>
      <span className="pc-name">{page.name || "Unnamed"}</span>
      <span className="pc-type">{type}</span>
      <span className="pc-dice">
        {page.dice.map((d) => (
          <span key={d.id} className={`pc-die ${d.kind}${d.counter ? " counter" : ""}`}>
            {diceLabel(d)}
          </span>
        ))}
      </span>
      {size === "hand" && page.effect && <span className="pc-effect">{page.effect}</span>}
    </button>
  );
}
