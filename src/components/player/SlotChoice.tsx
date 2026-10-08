import type { TableState } from "../../../shared/types.ts";
import { Overlay } from "./Overlay.tsx";

/**
 * Asked when slotting a single-target Page: Clash with the target (on which of their Speed Dice,
 * when they have more than one) or attack Unopposed.
 */
export function SlotChoice({
  table,
  pageName,
  targetId,
  onPick,
  onClose,
}: {
  table: TableState;
  pageName: string;
  targetId: string;
  onPick: (how: { targetDie?: number; unopposed?: boolean }) => void;
  onClose: () => void;
}) {
  const c = table.combat!;
  const target = table.tokens[targetId];
  const count = c.order.find((x) => x.tokenId === targetId)?.dice ?? 0;
  const held = (i: number) => c.slots.find((s) => s.ownerId === targetId && s.die === i && c.pages[s.pageId]?.type !== "instant");
  const describe = (i: number) => {
    const s = held(i);
    if (!s) return "Empty";
    const name = c.pages[s.pageId]?.name || "A Page";
    const at = s.targets.map((t) => table.tokens[t.tokenId]?.name).join(", ");
    return `${name}${at ? ` → ${at}` : ""}${s.clashWith ? " (already clashing)" : ""}`;
  };
  return (
    <Overlay title={`Use ${pageName || "Page"} on ${target?.name ?? "target"}`} onClose={onClose}>
      <h3 className="slot-choice-head">Clash</h3>
      {count > 1 ? (
        <>
          <p className="muted small">{target?.name} has {count} Speed Dice. Pick the one to slot against.</p>
          <ul className="plain dice-list">
            {Array.from({ length: count }, (_, i) => (
              <li key={i}>
                <button type="button" className="die-pick" onClick={() => onPick({ targetDie: i })}>
                  <strong>Speed Die {i + 1}</strong>
                  <span className="muted small">{describe(i)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <button type="button" className="die-pick" onClick={() => onPick({ targetDie: 0 })}>
          <strong>Clash</strong>
          <span className="muted small">{count ? describe(0) : "Slot against their Speed Die"}</span>
        </button>
      )}
      <h3 className="slot-choice-head">Unopposed</h3>
      <button type="button" className="die-pick" onClick={() => onPick({ unopposed: true })}>
        <strong>Unopposed attack</strong>
        <span className="muted small">Hits One-Sided on your turn without clashing with their Page.</span>
      </button>
    </Overlay>
  );
}
