import type { Character } from "../../../shared/character.ts";
import { rankTable } from "../../../shared/ruleset.ts";
import { PassiveList } from "../EquipmentEditor.tsx";

/** The Augment tab: its name, description and Passives. Proficiencies have their own tab (ProficienciesTab). */
export function AugmentTab({ c, update, npc }: { c: Character; update: (fn: (d: Character) => void) => void; npc?: boolean }) {
  const t = rankTable(c.rank);

  return (
    <div className="augment-tab">
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
