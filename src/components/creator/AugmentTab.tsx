import type { Character } from "../../../shared/character.ts";
import { newId } from "../../../shared/engine.ts";
import { proficiencyCount, rankTable } from "../../../shared/ruleset.ts";
import { PassiveList, withEffect } from "../EquipmentEditor.tsx";
import { AutomationPicker } from "../effects/EffectBuilder.tsx";

/**
 * The Augment & Proficiencies tab, laid out like the Inventory: Proficiencies as a slim list on
 * the left, and the Augment (name, description and Passives) on the right.
 */
export function AugmentTab({ c, update }: { c: Character; update: (fn: (d: Character) => void) => void }) {
  const t = rankTable(c.rank);
  const profMax = proficiencyCount(c.rank);

  return (
    <div className="inv-tab augment-tab">
      <aside className="inv-list" aria-label="Proficiencies" id="proficiencies">
        <div className="inv-head">
          <h3>Proficiencies</h3>
          <span className={c.proficiencies.length > profMax ? "error" : c.proficiencies.length === profMax ? "ok-text" : "warn-text"}>
            {c.proficiencies.length} / {profMax}
          </span>
        </div>
        <p className="muted small">
          They reflect your background, like a workshop Fixer with Proficiencies in modifying weapons. Each one may need minimum Stats. You get {profMax} at Rank {c.rank}.
        </p>
        {c.proficiencies.map((p, i) => (
          <div className="prof-row" key={p.id}>
            <span className="inv-count">{i + 1}</span>
            <div className="prof-fields">
              <input aria-label="Proficiency" placeholder="Proficiency" value={p.name} onChange={(e) => update((d) => void (d.proficiencies[i].name = e.target.value))} />
              <input
                aria-label="Notes"
                className="small"
                placeholder="Notes or requirement"
                value={p.description}
                onChange={(e) => update((d) => void (d.proficiencies[i].description = e.target.value))}
              />
              <AutomationPicker effectId={p.effectId} onChange={(effectId) => update((d) => void (d.proficiencies[i] = withEffect(d.proficiencies[i], effectId)))} />
            </div>
            <button type="button" className="icon" aria-label="Remove proficiency" onClick={() => update((d) => void d.proficiencies.splice(i, 1))}>
              ✕
            </button>
          </div>
        ))}
        {Array.from({ length: Math.max(0, profMax - c.proficiencies.length) }, (_, i) => (
          <div className="inv-row empty" key={`empty-${i}`}>
            Open Proficiency
          </div>
        ))}
        <button type="button" disabled={c.proficiencies.length >= profMax} onClick={() => update((d) => void d.proficiencies.push({ id: newId(), name: "", description: "" }))}>
          + Add proficiency
        </button>
      </aside>

      <section className="augment-card" id="augment" aria-label="Augment">
        <div className="augment-head">
          <span className="kicker">Augment</span>
          <span className="muted small">Max Passive Cost {t.augmentMaxCost} at Rank {c.rank}</span>
        </div>
        <p className="muted small">Your unique modification. Slot Passives up to your max Passive Cost. Work with your GM on something that fits your build and story.</p>
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
