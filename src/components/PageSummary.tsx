import type { Page } from "../../shared/character.ts";
import { diceLabel, PAGE_TYPES } from "./EquipmentEditor.tsx";

/** One line describing a Page: cost, type and dice. */
export function PageSummary({ page }: { page: Page }) {
  const type = PAGE_TYPES.find((t) => t.value === page.type)?.label ?? page.type;
  return (
    <span className="page-summary">
      <span className="page-cost" title="Light cost">
        {page.cost}
      </span>
      <span className="page-title">
        <strong>{page.name || "Unnamed Page"}</strong>
        <span className="muted small">
          {page.kind === "special" ? "Special" : "Basic"} · {type}
          {page.dice.length > 0 && ` · ${page.dice.map(diceLabel).join(", ")}`}
        </span>
      </span>
    </span>
  );
}
