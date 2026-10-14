import { useRef } from "react";
import type { Character } from "../../../shared/character.ts";
import { proficiencyCount } from "../../../shared/ruleset.ts";
import { ProficiencyPicker, ProficiencySlots, useLibrary } from "../effects/library.tsx";

/**
 * The Proficiencies tab: the character's picks as a slim list on the left, and the game's shared
 * Proficiency tree on the right to filter by required Stats and pick from. A GM's character picks
 * from a menu instead, without the picks limit or requirements.
 */
export function ProficienciesTab({ c, update, npc }: { c: Character; update: (fn: (d: Character) => void) => void; npc?: boolean }) {
  const lib = useLibrary();
  const max = proficiencyCount(c.rank);
  const tree = useRef<HTMLElement>(null);
  const set = (p: Character["proficiencies"]) => update((d) => void (d.proficiencies = p));
  const withTree = !npc && !!lib;

  return (
    <div className={"inv-tab proficiencies-tab" + (withTree ? "" : " list-only")}>
      <aside className="inv-list" aria-label="Your Proficiencies" id="proficiencies">
        <div className="inv-head">
          <h3>Proficiencies</h3>
          {npc ? (
            <span className="muted">{c.proficiencies.length}</span>
          ) : (
            <span className={c.proficiencies.length > max ? "error" : c.proficiencies.length === max ? "ok-text" : "warn-text"}>
              {c.proficiencies.length} / {max}
            </span>
          )}
        </div>
        <p className="muted small">
          {npc
            ? "Their background and training, picked from the game's shared Proficiencies."
            : `They reflect your background, like a workshop Fixer with Proficiencies in modifying weapons. You get 2 at Rank 9 and 2 more at each Rank Up: ${max} at Rank ${c.rank}.`}
        </p>
        <ProficiencySlots
          proficiencies={c.proficiencies}
          max={npc ? undefined : max}
          sheet={npc ? undefined : c}
          onChange={set}
          onOpenTree={() => tree.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        />
      </aside>

      {withTree && (
        <section className="proficiency-tree-card" aria-label="Proficiency tree" ref={tree}>
          <div className="augment-head">
            <span className="kicker">Proficiency tree</span>
            <span className="muted small">Shared by everyone in the game</span>
          </div>
          <p className="muted small">Some need other Proficiencies or minimum Stats first. Filter by the Stats they need, then tap one to see it and pick it.</p>
          <ProficiencyPicker proficiencies={c.proficiencies} sheet={c} max={max} onChange={set} />
        </section>
      )}
    </div>
  );
}
