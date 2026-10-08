import { type ReactNode, useRef, useState } from "react";
import type { Character } from "../../../shared/character.ts";
import { type Check, maxResources, PRIMARY_STATS, proficiencyCount, RANKS, rankTable, SECONDARY_STATS } from "../../../shared/ruleset.ts";
import { friendlyError } from "../../firebase.ts";
import { Stepper } from "../Fields.tsx";
import { uploadImage } from "../ImageUpload.tsx";
import { SecondaryStatIcon, StatIcon } from "../LorIcons.tsx";

export type CreatorStep = "intro" | "license" | "stats" | "story" | "summary";
export type SheetTab = "sheet" | "augment" | "inventory" | "decks";

const STEPS: { key: Exclude<CreatorStep, "intro">; label: string }[] = [
  { key: "license", label: "Fixer License" },
  { key: "stats", label: "Stats" },
  { key: "story", label: "Personality" },
  { key: "summary", label: "Summary" },
];
const ORDER: CreatorStep[] = ["intro", ...STEPS.map((s) => s.key)];

/** Where each kind of unfinished item gets fixed: a step here, or another tab. */
const FIX: Record<string, { step?: CreatorStep; tab?: SheetTab; label: string }> = {
  "Finishing Touches": { step: "license", label: "Fixer License" },
  Stats: { step: "stats", label: "Stats" },
  Proficiencies: { tab: "augment", label: "Augment & Proficiencies" },
  Augment: { tab: "augment", label: "Augment & Proficiencies" },
  Equipment: { tab: "decks", label: "Equipment & Decks" },
  Decks: { tab: "decks", label: "Equipment & Decks" },
  Inventory: { tab: "inventory", label: "Inventory" },
};

interface Props {
  c: Character;
  update: (fn: (d: Character) => void) => void;
  isGm: boolean;
  canEdit: boolean;
  /** Shown above the Stats when the GM approves players' changes to them (game settings). */
  statsNote?: ReactNode;
  gameId: string;
  uid: string;
  checks: Check[];
  step: CreatorStep;
  setStep: (s: CreatorStep) => void;
  goTab: (t: SheetTab) => void;
}

/** The character's photo on the license: tap it to upload a new one. */
function PortraitPicker({ folder, value, onChange, readOnly }: { folder: string; value?: string; onChange: (url: string | undefined) => void; readOnly?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const photo = value ? <img src={value} alt="Character photo" /> : <span className="license-photo-hint">{readOnly ? "No photo" : busy ? "Uploading…" : "Tap to add a photo"}</span>;
  if (readOnly) return <div className="license-photo">{photo}</div>;
  return (
    <div className="license-photo-wrap">
      <label className={"license-photo pickable" + (busy ? " busy" : "")} title={value ? "Change photo" : "Add a photo"}>
        {photo}
        <input
          type="file"
          accept="image/*"
          hidden
          aria-label="Character photo"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setBusy(true);
            setError("");
            try {
              onChange(await uploadImage(folder, file));
            } catch (err) {
              setError(friendlyError(err));
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {value && (
        <button type="button" className="link small" onClick={() => onChange(undefined)}>
          Remove photo
        </button>
      )}
      {error && <span className="error small">{error}</span>}
    </div>
  );
}

/** One labelled line on the license. */
function LicenseField({ label, value, onChange, readOnly, placeholder, wide }: { label: string; value: string; onChange: (v: string) => void; readOnly?: boolean; placeholder?: string; wide?: boolean }) {
  return (
    <label className={"license-field" + (wide ? " wide" : "")}>
      <span>{label}</span>
      {readOnly ? <strong>{value || "—"}</strong> : <input aria-label={label} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}

/** The Fixer License: an ID card with the character's photo and particulars. */
export function FixerLicense({ c, update, isGm, gameId, uid, readOnly }: Pick<Props, "c" | "update" | "isGm" | "gameId" | "uid"> & { readOnly?: boolean }) {
  const set = (key: keyof Character["details"]) => (v: string) => update((d) => void (d.details[key] = v));
  const number = `${uid.slice(0, 4)}-${uid.slice(4, 10)}`.toUpperCase();
  return (
    <div className={"license" + (readOnly ? " read-only" : "")} id="license">
      <div className="license-top">
        <span className="license-org">The City · Fixer License</span>
        <span className="license-no">No. {number}</span>
      </div>
      <div className="license-body">
        <PortraitPicker folder={`games/${gameId}/users/${uid}/portrait`} value={c.portrait} readOnly={readOnly} onChange={(url) => update((d) => void (url ? (d.portrait = url) : delete d.portrait))} />
        <div className="license-fields">
          <label className="license-field wide license-name">
            <span>Name</span>
            {readOnly ? <strong>{c.name || "—"}</strong> : <input aria-label="Name" value={c.name} placeholder="Your character's name" onChange={(e) => update((d) => void (d.name = e.target.value))} />}
          </label>
          <label className="license-field">
            <span>Grade (Rank)</span>
            {isGm && !readOnly ? (
              <select aria-label="Rank" value={c.rank} onChange={(e) => update((d) => void (d.rank = Number(e.target.value)))}>
                {RANKS.map((r) => (
                  <option key={r} value={r}>
                    Grade {r}
                  </option>
                ))}
              </select>
            ) : (
              <strong title="Only the GM can change your Rank">Grade {c.rank}</strong>
            )}
          </label>
          <LicenseField label="Occupation" value={c.details.occupation} onChange={set("occupation")} readOnly={readOnly} placeholder="Office, Syndicate, Wing…" />
          <LicenseField label="Age" value={c.details.age} onChange={set("age")} readOnly={readOnly} />
          <LicenseField label="Height" value={c.details.height} onChange={set("height")} readOnly={readOnly} />
          <LicenseField label="Birthplace" value={c.details.birthplace} onChange={set("birthplace")} readOnly={readOnly} placeholder="District" />
          <LicenseField label="Residence" value={c.details.residence} onChange={set("residence")} readOnly={readOnly} placeholder="District" />
        </div>
      </div>
      <label className="license-field wide license-appearance">
        <span>Appearance</span>
        {readOnly ? (
          <p>{c.details.appearance || "—"}</p>
        ) : (
          <textarea aria-label="Appearance" value={c.details.appearance} placeholder="What people notice first" onChange={(e) => update((d) => void (d.details.appearance = e.target.value))} />
        )}
      </label>
      <div className="license-bottom" aria-hidden="true">
        <span className="license-barcode" />
        <span className="license-sign">{c.name}</span>
      </div>
    </div>
  );
}

/** Live Resources from the current Rank and Stats. */
function ResourceBoard({ c }: { c: Character }) {
  const max = maxResources(c);
  const rows: [string, string | number, string][] = [
    ["Health", max.maxHp, "rb-hp"],
    ["Stagger", max.maxStagger, "rb-stagger"],
    ["Sanity", max.maxSanity, "rb-sanity"],
    ["Light", max.maxLight, "rb-light"],
    ["Speed", `1d6+${c.primary.justice}`, "rb-speed"],
  ];
  return (
    <div className="resource-board">
      {rows.map(([label, v, cls]) => (
        <div key={label} className={`rb-box ${cls}`}>
          <span className="rb-label">{label}</span>
          <span className="rb-val">{v}</span>
        </div>
      ))}
    </div>
  );
}

function StatsStep({ c, update, note }: Pick<Props, "c" | "update"> & { note?: ReactNode }) {
  const t = rankTable(c.rank);
  const primaryLeft = t.primaryPoints - Object.values(c.primary).reduce((a, b) => a + b, 0);
  const secondaryLeft = t.secondaryPoints - Object.values(c.secondary).reduce((a, b) => a + b, 0);
  return (
    <fieldset className="stats-step plain-fieldset" id="stats">
      {note}
      <ResourceBoard c={c} />
      <div className="stats-columns">
        <section className="stat-panel">
          <header>
            <h3>Primary Stats</h3>
            <span className={"points-orb" + (primaryLeft === 0 ? " done" : primaryLeft < 0 ? " over" : "")} aria-label={`${primaryLeft} primary points left`}>
              {primaryLeft}
            </span>
          </header>
          <p className="muted small">They shape your Resources. {t.primaryPoints} points at Rank {c.rank}.</p>
          <div className="primary-tiles">
            {PRIMARY_STATS.map((s) => (
              <div className="primary-tile" key={s.key}>
                <span className="tile-name">
                  <StatIcon stat={s.key} /> {s.label}
                </span>
                <span className="tile-value">{c.primary[s.key]}</span>
                <span className="muted small">{s.effect}</span>
                <Stepper label={s.label} value={c.primary[s.key]} max={c.primary[s.key] + Math.max(0, primaryLeft)} onChange={(n) => update((d) => void (d.primary[s.key] = n))} />
              </div>
            ))}
          </div>
        </section>
        <section className="stat-panel">
          <header>
            <h3>Secondary Stats</h3>
            <span className={"points-orb" + (secondaryLeft === 0 ? " done" : secondaryLeft < 0 ? " over" : "")} aria-label={`${secondaryLeft} secondary points left`}>
              {secondaryLeft}
            </span>
          </header>
          <p className="muted small">They add to Story Rolls. {t.secondaryPoints} points at Rank {c.rank}.</p>
          {SECONDARY_STATS.map((s) => (
            <div className="stat-row" key={s.key}>
              <div>
                <strong>
                  <SecondaryStatIcon stat={s.key} /> {s.label}
                </strong>
                <div className="muted small">{s.effect}</div>
              </div>
              <Stepper
                label={s.label}
                value={c.secondary[s.key] ?? 0}
                max={(c.secondary[s.key] ?? 0) + Math.max(0, secondaryLeft)}
                onChange={(n) => update((d) => void (d.secondary[s.key] = n))}
              />
            </div>
          ))}
        </section>
      </div>
    </fieldset>
  );
}

function StoryStep({ c, update }: Pick<Props, "c" | "update">) {
  return (
    <div className="story-step" id="story">
      <label className="story-card">
        <span className="story-title">Personality</span>
        <span className="muted small">How does your character respond to stress, to excitement, or fear? A defined personality helps your GM plan, and your party play off you.</span>
        <textarea aria-label="Personality" value={c.details.personality} placeholder="Calm under pressure, until someone threatens their friends…" onChange={(e) => update((d) => void (d.details.personality = e.target.value))} />
      </label>
      <label className="story-card">
        <span className="story-title">Relationships</span>
        <span className="muted small">Who matters to them in the City: family, rivals, an Office they owe, a Fixer they trust.</span>
        <textarea aria-label="Relationships" value={c.details.relationships} placeholder="A former partner in the Zwei Association…" onChange={(e) => update((d) => void (d.details.relationships = e.target.value))} />
      </label>
    </div>
  );
}

/** Everything about the character on one page, with what's left and where to finish it. */
function SummaryStep({ c, update, isGm, gameId, uid, checks, setStep, goTab }: Props) {
  const todo = checks.filter((ch) => !ch.ok);
  const t = rankTable(c.rank);
  return (
    <div className="summary-step" id="summary">
      {todo.length === 0 ? (
        <div className="ready-banner">✓ Ready for the table</div>
      ) : (
        <div className="todo-panel">
          <h3>Still to do</h3>
          <ul className="plain">
            {todo.map((ch, i) => {
              const fix = FIX[ch.step];
              return (
                <li key={i}>
                  <span>○ {ch.text}</span>
                  {fix && (
                    <button type="button" className="link small" onClick={() => (fix.step ? setStep(fix.step) : goTab(fix.tab!))}>
                      {fix.label} →
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="summary-grid">
        <FixerLicense c={c} update={update} isGm={isGm} gameId={gameId} uid={uid} readOnly />
        <div className="summary-col">
          <ResourceBoard c={c} />
          <section className="summary-card">
            <h4>Stats</h4>
            <div className="summary-stats-grid">
              {PRIMARY_STATS.map((s) => (
                <div key={s.key}>
                  <span className="muted small">
                    <StatIcon stat={s.key} size={14} /> {s.label}
                  </span>
                  <strong>{c.primary[s.key]}</strong>
                </div>
              ))}
              {SECONDARY_STATS.map((s) => (
                <div key={s.key}>
                  <span className="muted small">
                    <SecondaryStatIcon stat={s.key} size={14} /> {s.label}
                  </span>
                  <strong>{c.secondary[s.key] ?? 0}</strong>
                </div>
              ))}
            </div>
          </section>
          <section className="summary-card">
            <h4>Augment &amp; Proficiencies</h4>
            <p>
              <strong>{c.augment.name || "No Augment yet"}</strong>
              {c.augment.passives.length > 0 && <span className="muted small"> · {c.augment.passives.map((p) => p.name || "Unnamed").join(", ")}</span>}
            </p>
            <p className="muted small">
              {c.proficiencies.length ? c.proficiencies.map((p) => p.name || "Unnamed").join(" · ") : "No Proficiencies yet"} ({c.proficiencies.length}/{proficiencyCount(c.rank)})
            </p>
          </section>
          <section className="summary-card">
            <h4>Gear</h4>
            <p className="small">
              {c.weapons.length ? c.weapons.map((w) => w.name || "Unnamed weapon").join(", ") : "No weapons"}
              {" · "}
              {c.armor ? c.armor.name || "Unnamed armor" : "no armor"}
            </p>
            <p className="muted small">
              Combat Deck {c.deck.reduce((n, e) => n + e.copies, 0)} Pages · {c.ahn} Ahn · Inventory {c.inventory.items.length}/{c.inventory.slotCount} Slots
              {c.inventory.trinket ? ` · Trinket: ${c.inventory.trinket.name}` : ""} · Max Passive Cost {t.equipmentMaxCost}
            </p>
          </section>
        </div>
      </div>
      <div className="summary-story">
        <section className="summary-card">
          <h4>Personality</h4>
          <p className="pre">{c.details.personality || <span className="muted">Not written yet.</span>}</p>
        </section>
        <section className="summary-card">
          <h4>Relationships</h4>
          <p className="pre">{c.details.relationships || <span className="muted">Not written yet.</span>}</p>
        </section>
      </div>
    </div>
  );
}

function Intro({ c, setStep, goTab }: Pick<Props, "c" | "setStep" | "goTab">) {
  const t = rankTable(c.rank);
  return (
    <div className="creator-intro">
      <p className="kicker">Character creation</p>
      <h2>Become a Fixer</h2>
      <p>
        Every Fixer in the City carries a license. Fill in yours, then shape who your character is. You can move back and forth between the pages at any time, and everything saves as you go.
      </p>
      <ol className="intro-steps">
        <li>
          <strong>Fixer License</strong> · photo, name and particulars
        </li>
        <li>
          <strong>Stats</strong> · spend {t.primaryPoints} Primary and {t.secondaryPoints} Secondary points
        </li>
        <li>
          <strong>Personality</strong> · how they act, and who they know
        </li>
        <li>
          <strong>Summary</strong> · everything on one page, and what's left
        </li>
      </ol>
      <p className="muted small">
        Your{" "}
        <button type="button" className="link" onClick={() => goTab("augment")}>
          Augment &amp; Proficiencies
        </button>
        ,{" "}
        <button type="button" className="link" onClick={() => goTab("decks")}>
          Equipment &amp; Decks
        </button>{" "}
        and{" "}
        <button type="button" className="link" onClick={() => goTab("inventory")}>
          Inventory
        </button>{" "}
        have their own tabs. You start at Rank {c.rank}; your GM can change it.
      </p>
      <button type="button" className="big-button" onClick={() => setStep("license")}>
        Begin →
      </button>
    </div>
  );
}

/**
 * The Character tab: a short intro, then pages for the Fixer License, Stats, Personality and a
 * Summary. Move between them with the step bar or Back/Next; each step shows a ✓ once it's done.
 */
export function CharacterCreator(props: Props) {
  const { c, update, isGm, gameId, uid, checks, step, setStep } = props;
  const last = useRef(step);
  const dir = ORDER.indexOf(step) >= ORDER.indexOf(last.current) ? "forward" : "back";
  last.current = step;
  const index = ORDER.indexOf(step);
  const done = (key: CreatorStep) =>
    key === "license" ? !!c.name.trim() : key === "stats" ? checks.filter((ch) => ch.step === "Stats").every((ch) => ch.ok) : key === "story" ? !!(c.details.personality.trim() && c.details.relationships.trim()) : checks.every((ch) => ch.ok);

  return (
    <div className="creator">
      {step !== "intro" && (
        <nav className="creator-steps" aria-label="Character creation steps">
          <button type="button" className="creator-step-pill intro" onClick={() => setStep("intro")}>
            Intro
          </button>
          {STEPS.map((s, i) => (
            <button key={s.key} type="button" className={"creator-step-pill" + (s.key === step ? " current" : "") + (done(s.key) ? " done" : "")} aria-current={s.key === step ? "step" : undefined} onClick={() => setStep(s.key)}>
              <span className="pill-num">{done(s.key) ? "✓" : i + 1}</span>
              {s.label}
            </button>
          ))}
        </nav>
      )}
      <div key={step} className={`creator-page ${dir}`}>
        {step === "intro" && <Intro {...props} />}
        {step === "license" && <FixerLicense c={c} update={update} isGm={isGm} gameId={gameId} uid={uid} />}
        {step === "stats" && <StatsStep c={c} update={update} note={props.statsNote} />}
        {step === "story" && <StoryStep c={c} update={update} />}
        {step === "summary" && <SummaryStep {...props} />}
      </div>
      {step !== "intro" && (
        <div className="creator-nav">
          <button type="button" onClick={() => setStep(ORDER[index - 1])}>
            ← Back
          </button>
          {index < ORDER.length - 1 && (
            <button type="button" className="go" onClick={() => setStep(ORDER[index + 1])}>
              Next: {STEPS.find((s) => s.key === ORDER[index + 1])?.label} →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
