import type { Dice, Page } from "../../../shared/character.ts";
import { clashOdds } from "../../../shared/combat.ts";
import { isMassAttack } from "../../../shared/ruleset.ts";
import type { TableState } from "../../../shared/types.ts";
import { DiceIcon, dieRange } from "./DiceIcon.tsx";
import { Overlay } from "./Overlay.tsx";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const isOffensive = (d: Dice) => d.kind !== "block" && d.kind !== "evade";

/**
 * Die by die, how your Page would clash with theirs: each pair's Power ranges and your chance to win
 * it, from the dice alone (Stats and Effects can still change the rolls).
 */
export function ClashPreview({ mine, theirs, theirName }: { mine: Page; theirs: Page; theirName: string }) {
  const a = mine.dice.filter((d) => !d.counter);
  const b = theirs.dice.filter((d) => !d.counter);
  const rows = Math.max(a.length, b.length);
  return (
    <div className="clash-preview" aria-label={`Clash preview against ${theirs.name}`}>
      <div className="cp-head muted small">
        <span>{mine.name || "Your Page"}</span>
        <span>vs</span>
        <span>
          {theirName}'s {theirs.name || "Page"}
        </span>
      </div>
      {Array.from({ length: rows }, (_, i) => {
        const x = a[i];
        const y = b[i];
        const odds = x && y ? clashOdds(x, y) : undefined;
        const tone = odds ? (odds.win > odds.lose ? "good" : odds.win < odds.lose ? "bad" : "even") : "";
        return (
          <div className="cp-row" key={i}>
            <span className="cp-die">{x ? <><DiceIcon dice={x} size={20} /> {dieRange(x)}</> : <span className="muted">—</span>}</span>
            <span className={"cp-odds " + tone}>
              {odds ? `Win ${pct(odds.win)}` : x ? (isOffensive(x) ? "Hits" : "Counter") : y && isOffensive(y) ? "Hits you" : "—"}
            </span>
            <span className="cp-die theirs">{y ? <>{dieRange(y)} <DiceIcon dice={y} size={20} /></> : <span className="muted">—</span>}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Asked when slotting a single-target Page: Clash with the target (on which of their Speed Dice,
 * when they have more than one) or attack Unopposed. A die holding a Page shows a clash preview.
 */
export function SlotChoice({
  table,
  page,
  meId,
  targetId,
  onPick,
  onClose,
}: {
  table: TableState;
  page: Page;
  meId: string | undefined;
  targetId: string;
  onPick: (how: { targetDie?: number; unopposed?: boolean }) => void;
  onClose: () => void;
}) {
  const c = table.combat!;
  const target = table.tokens[targetId];
  const count = c.order.find((x) => x.tokenId === targetId)?.dice ?? 0;
  const held = (i: number) => c.slots.find((s) => s.ownerId === targetId && s.die === i && c.pages[s.pageId]?.type !== "instant");
  // Mirrors the engine: a free Page on that die clashes; a Mass Attack only if it's aimed at you.
  const clashesWith = (i: number) => {
    const s = held(i);
    const p = s && c.pages[s.pageId];
    if (!s || !p || s.clashWith) return undefined;
    if (isMassAttack(p.type) && !s.targets.some((t) => t.tokenId === meId)) return undefined;
    return p;
  };
  const describe = (i: number) => {
    const s = held(i);
    if (!s) return "Empty";
    const name = c.pages[s.pageId]?.name || "A Page";
    const at = s.targets.map((t) => table.tokens[t.tokenId]?.name).join(", ");
    return `${name}${at ? ` → ${at}` : ""}${s.clashWith ? " (already clashing)" : ""}`;
  };
  const option = (i: number, label: string) => {
    const theirs = clashesWith(i);
    return (
      <button type="button" className="die-pick" onClick={() => onPick({ targetDie: i })}>
        <strong>{label}</strong>
        <span className="muted small">{describe(i)}</span>
        {theirs && <ClashPreview mine={page} theirs={theirs} theirName={target?.name ?? "Their"} />}
      </button>
    );
  };
  return (
    <Overlay title={`Use ${page.name || "Page"} on ${target?.name ?? "target"}`} onClose={onClose}>
      <h3 className="slot-choice-head">Clash</h3>
      {count > 1 ? (
        <>
          <p className="muted small">{target?.name} has {count} Speed Dice. Pick the one to slot against.</p>
          <ul className="plain dice-list">
            {Array.from({ length: count }, (_, i) => (
              <li key={i}>{option(i, `Speed Die ${i + 1}`)}</li>
            ))}
          </ul>
        </>
      ) : count === 1 ? (
        option(0, "Clash")
      ) : (
        <button type="button" className="die-pick" onClick={() => onPick({ targetDie: 0 })}>
          <strong>Clash</strong>
          <span className="muted small">Slot against their Speed Die</span>
        </button>
      )}
      <h3 className="slot-choice-head">Unopposed</h3>
      <button type="button" className="die-pick" onClick={() => onPick({ unopposed: true })}>
        <strong>Unopposed attack</strong>
        <span className="muted small">Hits One-Sided on your turn without clashing with their Page.</span>
      </button>
      <p className="muted small">Win chances count the dice alone; Stats and Effects can still change the rolls.</p>
    </Overlay>
  );
}
