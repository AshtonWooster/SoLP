import type { DeckEntry, Page } from "../../shared/character.ts";
import { blankPage, enemyDeck } from "../../shared/ruleset.ts";
import { PageEditor } from "./EquipmentEditor.tsx";
import { Stepper } from "./Fields.tsx";

/** An enemy's Pages and how many copies of each are in its Combat Deck. No size limit. */
export function EnemyDeckEditor({
  pages,
  deck,
  onChange,
}: {
  pages: Page[];
  deck: DeckEntry[];
  onChange: (pages: Page[], deck: DeckEntry[]) => void;
}) {
  const copies = (id: string) => deck.find((e) => e.pageId === id)?.copies ?? 0;
  const setCopies = (id: string, n: number) =>
    onChange(pages, [...deck.filter((e) => e.pageId !== id), ...(n > 0 ? [{ pageId: id, copies: n }] : [])]);
  const total = enemyDeck(pages, deck).length;
  return (
    <div className="enemy-deck">
      <p className="muted small">
        Combat Deck: {total} Page{total === 1 ? "" : "s"}
        {deck.length === 0 && pages.length > 0 ? " (one of each until you set copies)" : ""}. Enemies draw 3 to start and 1 each Upkeep, like players.
      </p>
      {pages.map((p, i) => (
        <div className="enemy-page" key={p.id}>
          <div className="row-between">
            <span className="muted small">Copies in deck</span>
            <Stepper label={`copies of ${p.name || "page"}`} value={copies(p.id)} min={0} max={99} onChange={(n) => setCopies(p.id, n)} />
          </div>
          <PageEditor
            page={p}
            onChange={(np) => onChange(pages.map((x, j) => (j === i ? np : x)), deck)}
            onRemove={() => onChange(pages.filter((_, j) => j !== i), deck.filter((e) => e.pageId !== p.id))}
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          const page = { ...blankPage("basic"), name: `Attack ${pages.length + 1}` };
          onChange([...pages, page], [...deck, { pageId: page.id, copies: 3 }]);
        }}
      >
        + Add Page
      </button>
    </div>
  );
}
