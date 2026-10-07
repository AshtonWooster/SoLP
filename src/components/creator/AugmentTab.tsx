import type { Character } from "../../../shared/character.ts";
import { proficiencyCount, rankTable } from "../../../shared/ruleset.ts";
import { PassiveList } from "../EquipmentEditor.tsx";
import { ProficiencySlots } from "../effects/library.tsx";

/**
 * The Augment & Proficiencies tab, laid out like the Inventory: Proficiencies as a slim list on
 * the left, and the Augment (name, description and Passives) on the right.
 */
export function AugmentTab({ c, update, npc }: { c: Character; update: (fn: (d: Character) => void) => void; npc?: boolean }) {
  const t = rankTable(c.rank);
  const profMax = proficiencyCount(c.rank);

  return (
    <div className="inv-tab augment-tab">
      <aside className="inv-list" aria-label="Proficiencies" id="proficiencies">
        <div className="inv-head">
          <h3>Proficiencies</h3>
          {npc ? (
            <span className="muted">{c.proficiencies.length}</span>
          ) : (
            <span className={c.proficiencies.length > profMax ? "error" : c.proficiencies.length === profMax ? "ok-text" : "warn-text"}>
              {c.proficiencies.length} / {profMax}
            </span>
          )}
        </div>
        <p className="muted small">
          {npc
            ? "Their background and training, picked from the game's shared Proficiencies."
            : `They reflect your background, like a workshop Fixer with Proficiencies in modifying weapons. Each one may need minimum Stats. You get ${profMax} at Rank ${c.rank}. Pick them from the game's shared Proficiencies.`}
        </p>
        <ProficiencySlots proficiencies={c.proficiencies} max={npc ? undefined : profMax} onChange={(p) => update((d) => void (d.proficiencies = p))} />
      </aside>

      <section className="augment-card" id="augment" aria-label="Augment">
        <div className="augment-head">
          <span className="kicker">Augment</span>
          <span className="muted small">Max Passive Cost {t.augmentMaxCost} at Rank {c.rank}</span>
        </div>
        <p className="muted small">
          {npc ? "Their unique modification. Slot Passives up to the max Passive Cost." : "Your unique modification. Slot Passives up to your max Passive Cost. Work with your GM on something that fits your build and story."}
        </p>
        <input
          className="augment-name"
          aria-label="Augment name"
          placeholder="Name your Augment"
          value={c.augment.name}
          onChange={(e) => update((d) => void (d.augment.name = e.target.value))}
        />
        <textarea
          aria-label="Description"
          placeholder="What it is, how it was installed, what it looks like"
          value={c.augment.description}
          onChange={(e) => update((d) => void (d.augment.description = e.target.value))}
        />
        <PassiveList passives={c.augment.passives} max={t.augmentMaxCost} onChange={(p) => update((d) => void (d.augment.passives = p))} />
      </section>
    </div>
  );
}
