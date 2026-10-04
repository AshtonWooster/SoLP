import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { addDoc, collection, deleteDoc, doc, setDoc } from "firebase/firestore";
import type { EnemyTemplate, ResistanceSet } from "../../shared/character.ts";
import { blankEnemy, enemyDeck } from "../../shared/ruleset.ts";
import type { GameDoc } from "../../shared/types.ts";
import { useAuth, useCollection, useDoc } from "../api.ts";
import { EnemyDeckEditor } from "../components/EnemyDeckEditor.tsx";
import { NumberInput, Section, TextField } from "../components/Fields.tsx";
import { TopBar } from "../components/TopBar.tsx";
import { db, friendlyError } from "../firebase.ts";

const SAVE_DELAY_MS = 600;

function ResistanceRow({ label, value, onChange }: { label: string; value: ResistanceSet; onChange: (r: ResistanceSet) => void }) {
  return (
    <div>
      <h4>{label}</h4>
      <div className="row wrap">
        {(["slash", "pierce", "blunt"] as const).map((k) => (
          <label className="inline" key={k}>
            {k[0].toUpperCase() + k.slice(1)} ×
            <NumberInput label={`${label} ${k}`} value={value[k]} step={0.1} min={0} onChange={(n) => onChange({ ...value, [k]: Math.max(0, n) })} />
          </label>
        ))}
      </div>
    </div>
  );
}

/** Edits one template, saving shortly after each change. */
function TemplateEditor({ gameId, id, template }: { gameId: string; id: string; template: EnemyTemplate }) {
  const [t, setT] = useState(template);
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dirty = useRef(false);
  // Follow changes from elsewhere unless there are unsaved local edits.
  useEffect(() => {
    if (!dirty.current) setT(template);
  }, [template]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const update = (patch: Partial<EnemyTemplate>) => {
    const next = { ...t, ...patch };
    setT(next);
    dirty.current = true;
    setStatus("Saving…");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await setDoc(doc(db, "games", gameId, "enemies", id), { ...next, updatedAt: Date.now() });
        dirty.current = false;
        setStatus("Saved");
      } catch (err) {
        setStatus(friendlyError(err));
      }
    }, SAVE_DELAY_MS);
  };

  return (
    <div className="template-editor">
      <div className="row-between">
        <h2>{t.name || "Unnamed enemy"}</h2>
        <span className={status === "Saved" ? "ok-text" : "muted"}>{status}</span>
      </div>
      <Section id="basics" title="Basics">
        <div className="row wrap">
          <TextField label="Name" value={t.name} onChange={(name) => update({ name })} />
          <label className="field">
            <span>Token color</span>
            <input type="color" value={t.color} onChange={(e) => update({ color: e.target.value })} />
          </label>
        </div>
        <div className="row wrap">
          {(
            [
              ["maxHp", "Health"],
              ["maxStagger", "Stagger Resist"],
              ["maxLight", "Light"],
              ["maxSanity", "Sanity"],
              ["justice", "Justice"],
            ] as const
          ).map(([key, label]) => (
            <label className="field" key={key}>
              <span>{label}</span>
              <NumberInput label={label} value={t[key]} onChange={(n) => update({ [key]: Math.round(n) })} />
            </label>
          ))}
        </div>
        <ResistanceRow label="Damage resistances" value={t.resistances} onChange={(resistances) => update({ resistances })} />
        <ResistanceRow label="Stagger resistances" value={t.staggerResistances} onChange={(staggerResistances) => update({ staggerResistances })} />
        <TextField label="GM notes" multiline value={t.notes} onChange={(notes) => update({ notes })} />
      </Section>
      <Section id="deck" title="Pages and Combat Deck">
        <EnemyDeckEditor pages={t.pages} deck={t.deck} onChange={(pages, deck) => update({ pages, deck })} />
      </Section>
    </div>
  );
}

/** The GM's enemy templates: design an enemy once, then place copies of it from the GM screen. */
export function Enemies() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const game = useDoc<GameDoc>(`games/${id}`);
  const isGm = !!user && game.data?.gmId === user.id;
  const templates = useCollection<EnemyTemplate>(isGm ? `games/${id}/enemies` : null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");

  if (game.loading) return <main className="center muted">Loading…</main>;
  if (!isGm) {
    return (
      <>
        <TopBar />
        <main className="center">
          <p className="error">Only the GM can see enemy templates.</p>
          <Link to={`/games/${id}`}>Back to the game</Link>
        </main>
      </>
    );
  }
  const list = Object.entries(templates ?? {}).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const current = selected && templates?.[selected] ? selected : null;

  return (
    <>
      <TopBar />
      <main className="enemies">
        <header className="sheet-header">
          <Link to={`/games/${id}`} className="muted">← {game.data!.name}</Link>
          <h1>Enemy templates</h1>
          <p className="muted">Design an enemy once, then place as many copies as you need from the GM screen. Each copy has its own Health, Light and deck.</p>
        </header>
        <aside className="template-list panel">
          <button
            className="big-button"
            onClick={async () => {
              try {
                const ref = await addDoc(collection(db, "games", id, "enemies"), { ...blankEnemy(), name: "New enemy" });
                setSelected(ref.id);
              } catch (err) {
                setError(friendlyError(err));
              }
            }}
          >
            + New enemy
          </button>
          {error && <p className="error">{error}</p>}
          {templates === undefined && <p className="muted">Loading…</p>}
          {list.length === 0 && templates && <p className="muted">No templates yet.</p>}
          <ul className="plain">
            {list.map(([tid, t]) => (
              <li key={tid}>
                <button className={"template-item" + (tid === current ? " active" : "")} onClick={() => setSelected(tid)}>
                  <span className="swatch" style={{ background: t.color }} /> {t.name || "Unnamed"}
                  <span className="muted small">
                    {t.maxHp} HP · {enemyDeck(t.pages ?? [], t.deck).length} Pages
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <section className="template-main">
          {current ? (
            <>
              <TemplateEditor key={current} gameId={id} id={current} template={{ ...blankEnemy(), ...templates![current] }} />
              <button
                className="danger"
                onClick={async () => {
                  if (!confirm("Delete this template? Enemies already on the map stay.")) return;
                  await deleteDoc(doc(db, "games", id, "enemies", current));
                  setSelected(null);
                }}
              >
                Delete template
              </button>
            </>
          ) : (
            <p className="muted">Pick a template, or create a new one.</p>
          )}
        </section>
      </main>
    </>
  );
}
