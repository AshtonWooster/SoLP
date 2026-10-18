import type { Dice, Page } from "../../../shared/character.ts";
import { guardDice } from "../../../shared/engine.ts";
import { isMassAttack, moveCost, pageRange } from "../../../shared/ruleset.ts";
import type { TableState } from "../../../shared/types.ts";
import { DiceIcon, dieRange } from "./DiceIcon.tsx";
import { Overlay } from "./Overlay.tsx";

const isOffensive = (d: Dice) => d.kind !== "block" && d.kind !== "evade";

/**
 * Die by die, how your Page would clash with theirs: each pair's Power ranges side by side, with
 * unpaired dice marked as hitting One-Sided or held as a Counter.
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
        return (
          <div className="cp-row" key={i}>
            <span className="cp-die">{x ? <><DiceIcon dice={x} size={20} /> {dieRange(x)}</> : <span className="muted">—</span>}</span>
            <span className="cp-odds">
              {x && y ? "Clash" : x ? (isOffensive(x) ? "Hits" : "Counter") : y && isOffensive(y) ? "Hits you" : "—"}
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
 * With the Game setting "Weapon properties": a Page from an Offensive Weapon can resolve the Clash
 * right away, and a Defensive Weapon's Page aimed at a target out of range can only Clash with
 * their Page aimed at an ally within range.
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
  onPick: (how: { targetDie?: number; unopposed?: boolean; resolveNow?: boolean }) => void;
  onClose: () => void;
}) {
  const c = table.combat!;
  const target = table.tokens[targetId];
  const me = meId ? table.tokens[meId] : undefined;
  const count = c.order.find((x) => x.tokenId === targetId)?.dice ?? 0;
  // A Defensive Weapon guarding an ally: past the Page's range, only the dice whose Page is aimed at an ally within it.
  const guarding = !!me && !!target && moveCost(me, target) > pageRange(page);
  const guard = guarding && me ? guardDice(table, me, page, targetId) : [];
  const offensive = page.weaponStyle === "offensive";
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
    const disabled = guarding && !guard.includes(i);
    return (
      <>
        <button type="button" className="die-pick" disabled={disabled} onClick={() => onPick({ targetDie: i })}>
          <strong>{label}</strong>
          <span className="muted small">{disabled ? `${describe(i)}: not aimed at an ally within your range` : describe(i)}</span>
          {theirs && <ClashPreview mine={page} theirs={theirs} theirName={target?.name ?? "Their"} />}
        </button>
        {offensive && theirs && !isMassAttack(theirs.type) && !disabled && (
          <button type="button" className="die-pick resolve-now" onClick={() => onPick({ targetDie: i, resolveNow: true })}>
            <strong>{label}: Clash now</strong>
            <span className="muted small">Offensive Weapon: resolve this Clash right away instead of waiting for your next turn.</span>
          </button>
        )}
      </>
    );
  };
  return (
    <Overlay title={`Use ${page.name || "Page"} on ${target?.name ?? "target"}`} onClose={onClose}>
      <h3 className="slot-choice-head">Clash</h3>
      {guarding && <p className="muted small">Defensive Weapon: {target?.name} is out of range, but you can Clash with their Page aimed at an ally within your range.</p>}
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
      {!guarding && (
        <>
          <h3 className="slot-choice-head">Unopposed</h3>
          <button type="button" className="die-pick" onClick={() => onPick({ unopposed: true })}>
            <strong>Unopposed attack</strong>
            <span className="muted small">Hits One-Sided on your turn without clashing with their Page.</span>
          </button>
        </>
      )}
    </Overlay>
  );
}
