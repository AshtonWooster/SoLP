import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, deleteDoc, doc, setDoc, updateDoc } from "firebase/firestore";
import { entriesOf, useEffectLibrary } from "../components/effects/library.tsx";
import type { EffectDef } from "../../shared/effects.ts";
import type { GameDoc } from "../../shared/types.ts";
import {
  AURA_STYLES,
  blankVfx,
  cleanVfx,
  copyVfx,
  FULL_STACKS,
  ICON_SPOTS,
  LAYER_TYPES,
  linkStatus,
  MAX_LAYERS,
  MAX_PARTICLES,
  MOTIONS,
  moveLayer,
  newLayer,
  PARTICLE_FLOWS,
  PLAY_OPTIONS,
  playLabel,
  PARTICLE_SHAPES,
  statusVfxOn,
  TINT_STYLES,
  VFX_TEMPLATES,
  type VfxDef,
  type VfxLayer,
  type VfxLayerType,
} from "../../shared/vfx.ts";
import { useAuth, useDoc } from "../api.ts";
import { ConfirmButton } from "../components/ConfirmButton.tsx";
import { TopBar } from "../components/TopBar.tsx";
import { useVfxLibrary } from "../components/vfx/useVfx.ts";
import { gainMs, motionStyle, VfxView } from "../components/vfx/VfxView.tsx";
import { db, friendlyError } from "../firebase.ts";

const SAVE_DELAY_MS = 500;
const layerLabel = (t: VfxLayerType) => LAYER_TYPES.find((x) => x.value === t)!.label;

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Slider({ label, value, min, max, step, onChange, show }: { label: string; value: number; min: number; max: number; step: number; onChange: (n: number) => void; show?: (n: number) => string }) {
  return (
    <label className="field vfx-slider">
      <span>
        {label} <b>{show ? show(value) : value}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (c: string) => void }) {
  return (
    <label className="field vfx-color">
      <span>{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

const times = (n: number) => `${n}×`;
const percent = (n: number) => `${Math.round(n * 100)}%`;

/** The settings for one layer: only the ones that matter for its type. */
function LayerCard({ layer, index, count, onChange, onMove, onRemove }: { layer: VfxLayer; index: number; count: number; onChange: (l: VfxLayer) => void; onMove: (dir: -1 | 1) => void; onRemove: () => void }) {
  const set = (patch: Partial<VfxLayer>) => onChange({ ...layer, ...patch });
  return (
    <li className="vfx-layer-card">
      <div className="row-between">
        <strong>
          <span className="vfx-swatch" style={{ background: layer.color }} /> {layerLabel(layer.type)}
        </strong>
        <span className="row">
          <button type="button" className="icon" aria-label="Move behind" title="Move behind" disabled={index === 0} onClick={() => onMove(-1)}>
            ↑
          </button>
          <button type="button" className="icon" aria-label="Move in front" title="Move in front" disabled={index === count - 1} onClick={() => onMove(1)}>
            ↓
          </button>
          <button type="button" className="icon" aria-label={`Remove ${layerLabel(layer.type)}`} title="Remove" onClick={onRemove}>
            ✕
          </button>
        </span>
      </div>
      <div className="row wrap vfx-controls">
        {layer.type === "aura" && <Choice label="Style" value={layer.aura ?? "glow"} options={AURA_STYLES} onChange={(aura) => set({ aura })} />}
        {layer.type === "particles" && (
          <>
            <Choice label="Shape" value={layer.shape ?? "dot"} options={PARTICLE_SHAPES} onChange={(shape) => set({ shape, glyph: shape === "glyph" ? (layer.glyph ?? "✦") : undefined })} />
            <Choice label="Movement" value={layer.flow ?? "rise"} options={PARTICLE_FLOWS} onChange={(flow) => set({ flow })} />
          </>
        )}
        {layer.type === "tint" && <Choice label="Style" value={layer.tint ?? "pulse"} options={TINT_STYLES} onChange={(tint) => set({ tint })} />}
        {layer.type === "motion" && <Choice label="Movement" value={layer.motion ?? "shake"} options={MOTIONS} onChange={(motion) => set({ motion })} />}
        {layer.type === "icon" && <Choice label="Where" value={layer.spot ?? "topRight"} options={ICON_SPOTS} onChange={(spot) => set({ spot })} />}
        {(layer.type === "icon" || layer.shape === "glyph") && (
          <label className="field vfx-glyph">
            <span>Symbol</span>
            <input value={layer.glyph ?? ""} maxLength={16} placeholder="✦" onChange={(e) => set({ glyph: e.target.value })} />
          </label>
        )}
        {layer.type !== "motion" && <Color label="Color" value={layer.color} onChange={(color) => set({ color })} />}
        {layer.type === "particles" && (
          <label className="field vfx-color">
            <span>Mix in</span>
            <span className="row">
              <input type="checkbox" aria-label="Mix in a second color" checked={!!layer.color2} onChange={(e) => set({ color2: e.target.checked ? "#ffffff" : undefined })} />
              {layer.color2 && <input type="color" aria-label="Second color" value={layer.color2} onChange={(e) => set({ color2: e.target.value })} />}
            </span>
          </label>
        )}
      </div>
      <div className="row wrap vfx-controls">
        {layer.type === "particles" && <Slider label="Amount" value={layer.count ?? 8} min={1} max={MAX_PARTICLES} step={1} onChange={(count) => set({ count })} />}
        {layer.type !== "tint" && <Slider label={layer.type === "motion" ? "Strength" : "Size"} value={layer.size} min={0.25} max={3} step={0.05} show={times} onChange={(size) => set({ size })} />}
        <Slider label="Speed" value={layer.speed} min={0.25} max={3} step={0.05} show={times} onChange={(speed) => set({ speed })} />
        {layer.type !== "motion" && <Slider label="Strength" value={layer.opacity} min={0.1} max={1} step={0.05} show={percent} onChange={(opacity) => set({ opacity })} />}
      </div>
    </li>
  );
}

/** A sample token with the VFX on it, at however many stacks the GM picks. */
function Preview({ def }: { def: VfxDef }) {
  const [stacks, setStacks] = useState(3);
  const [replay, setReplay] = useState(0);
  const [playing, setPlaying] = useState(false);
  // "When gained" VFX play once: on opening, on Replay, and whenever they're changed.
  const sig = JSON.stringify(def.layers) + def.play;
  useEffect(() => {
    if (def.play === "loop") return setPlaying(false);
    setPlaying(true);
    const t = setTimeout(() => setPlaying(false), gainMs(def));
    return () => clearTimeout(t);
  }, [sig, replay]);
  const show = def.play === "loop" || playing;
  const once = def.play !== "loop";
  const list = show ? [{ def, stacks, once }] : [];
  return (
    <div className="vfx-preview">
      <div className="vfx-stage">
        <span className="token player vfx-sample" style={motionStyle(list)}>
          {show && <VfxView key={`${replay}-${def.play}`} def={def} stacks={stacks} once={once} />}
          <span className="token-name">Preview</span>
        </span>
      </div>
      <div className="row wrap vfx-preview-controls">
        <Slider label="Stacks" value={stacks} min={1} max={FULL_STACKS} step={1} onChange={setStacks} />
        {once && (
          <button type="button" onClick={() => setReplay((r) => r + 1)}>
            ▶ Play again
          </button>
        )}
      </div>
    </div>
  );
}

/** Which status Effects the VFX plays on: tap one to turn it on or off. */
function StatusLinks({ def, effects, onChange }: { def: VfxDef; effects: [string, EffectDef][]; onChange: (d: VfxDef) => void }) {
  return (
    <section className="vfx-section" aria-label="Plays on">
      <h3>Plays on these status effects</h3>
      <p className="muted small">Tap a status effect to play this VFX on anyone who has it. Changing the VFX changes it everywhere it plays.</p>
      <div className="row wrap">
        {effects.map(([id, e]) => {
          const on = def.statuses.includes(id);
          return (
            <button key={id} type="button" className={"chip" + (on ? " active" : "")} aria-pressed={on} onClick={() => onChange(linkStatus(def, id, !on))}>
              {on ? "✓ " : ""}
              {e.name || "Unnamed"}
            </button>
          );
        })}
        {effects.length === 0 && <span className="muted">No status effects yet. Make them in the Effect library.</span>}
      </div>
    </section>
  );
}

/** Edits one VFX, saving shortly after each change. */
function VfxEditor({ gameId, id, def, effects, footer }: { gameId: string; id: string; def: VfxDef; effects: [string, EffectDef][]; footer: ReactNode }) {
  const [d, setD] = useState(def);
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) setD(def);
  }, [def]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const update = (next: VfxDef) => {
    setD(next);
    dirty.current = true;
    setStatus("Saving…");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await setDoc(doc(db, "games", gameId, "vfx", id), cleanVfx({ ...next, updatedAt: Date.now() }));
        dirty.current = false;
        setStatus("Saved");
      } catch (err) {
        setStatus(friendlyError(err));
      }
    }, SAVE_DELAY_MS);
  };
  const setLayer = (l: VfxLayer) => update({ ...d, layers: d.layers.map((x) => (x.id === l.id ? l : x)) });
  const hasMotion = d.layers.some((l) => l.type === "motion");
  return (
    <div className="item-editor vfx-editor">
      <span className={"save-state " + (status === "Saved" ? "saved" : "")}>{status}</span>
      <label className="field">
        <span>Name</span>
        <input value={d.name} maxLength={60} onChange={(e) => update({ ...d, name: e.target.value })} />
      </label>
      <Preview def={d} />
      <div className="row wrap vfx-play">
        <span className="muted small">Plays</span>
        <div className="segmented" role="radiogroup" aria-label="Plays">
          {PLAY_OPTIONS.map(({ value, label }) => (
            <button key={value} type="button" role="radio" aria-checked={d.play === value} className={"chip" + (d.play === value ? " active" : "")} onClick={() => update({ ...d, play: value })}>
              {label}
            </button>
          ))}
        </div>
        <label className="row small">
          <input type="checkbox" checked={!!d.scaleWithStacks} onChange={(e) => update({ ...d, scaleWithStacks: e.target.checked || undefined })} />
          Stronger with more stacks
        </label>
      </div>

      <section className="vfx-section" aria-label="Layers">
        <h3>Layers</h3>
        <ol className="plain vfx-layers">
          {d.layers.map((l, i) => (
            <LayerCard
              key={l.id}
              layer={l}
              index={i}
              count={d.layers.length}
              onChange={setLayer}
              onMove={(dir) => update(moveLayer(d, l.id, dir))}
              onRemove={() => update({ ...d, layers: d.layers.filter((x) => x.id !== l.id) })}
            />
          ))}
        </ol>
        {d.layers.length === 0 && <p className="muted">No layers: add one below to see it.</p>}
        {d.layers.length < MAX_LAYERS ? (
          <div className="row wrap vfx-add">
            <span className="muted small">Add</span>
            {LAYER_TYPES.filter((t) => t.value !== "motion" || !hasMotion).map((t) => (
              <button key={t.value} type="button" className="chip" title={t.hint} onClick={() => update({ ...d, layers: [...d.layers, newLayer(t.value, d.layers.find((l) => l.type !== "motion")?.color)] })}>
                + {t.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="muted small">That's the most layers one VFX can have ({MAX_LAYERS}).</p>
        )}
      </section>

      <StatusLinks def={d} effects={effects} onChange={update} />
      <div className="row wrap">{footer}</div>
    </div>
  );
}

/**
 * The VFX editor (GM only): build looks from layers (auras, particles, tints, icons, motion), see them
 * live on a sample token, and pick the status Effects each plays on. Saved per game and reused anywhere.
 */
export function Vfx() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const game = useDoc<GameDoc>(`games/${id}`);
  const isGm = !!user && game.data?.gmId === user.id;
  const own = useVfxLibrary(isGm ? id : null);
  const effectLibrary = useEffectLibrary(isGm ? id : null);
  const statuses = useMemo(() => entriesOf(effectLibrary, "status"), [effectLibrary]);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");

  const list = useMemo(
    () =>
      Object.entries(own ?? {})
        .filter(([, d]) => (d.name ?? "").toLowerCase().includes(search.trim().toLowerCase()))
        .sort((a, b) => (a[1].name ?? "").localeCompare(b[1].name ?? "")),
    [own, search],
  );

  if (game.loading) return <main className="center muted">Loading…</main>;
  if (!isGm) {
    return (
      <>
        <TopBar />
        <main className="center">
          <p className="error">Only the GM can make VFX.</p>
          <Link to={`/games/${id}`}>Back</Link>
        </main>
      </>
    );
  }
  const statusName = (sid: string) => effectLibrary[sid]?.name;
  const create = async (from: VfxDef) => {
    const ref = doc(collection(db, "games", id, "vfx"));
    try {
      await setDoc(ref, cleanVfx({ ...from, updatedAt: Date.now() }));
      setSelected(ref.id);
    } catch (err) {
      setMessage(friendlyError(err));
    }
  };
  const current = selected && own?.[selected] ? selected : null;
  const def = current ? cleanVfx(own![current]) : undefined;
  const on = statusVfxOn(game.data);

  return (
    <>
      <TopBar />
      <main className="items-page vfx-page">
        <header className="sheet-header">
          <Link to={`/games/${id}`} className="muted">
            ← {game.data!.name}
          </Link>
          <h1>VFX editor</h1>
          <p className="muted">Build looks for status effects from layers: glows, particles, tints, icons and motion. Make one once, then play it on as many status effects as you like.</p>
          {!on && (
            <div className="vfx-off panel">
              <span>
                <strong>VFX are off in this game.</strong> <span className="muted small">You can build them now; they play on the map once you turn on Status effect VFX in Game settings.</span>
              </span>
              <button
                type="button"
                className="chip go"
                onClick={() => updateDoc(doc(db, "games", id), { "settings.statusVfx": true }).catch((e) => setMessage(friendlyError(e)))}
              >
                Turn on
              </button>
            </div>
          )}
          {message && (
            <p className="muted" role="status">
              {message}
            </p>
          )}
        </header>

        <div className="equip-studio items-studio effects-studio">
          <div className="equip-editor">
            {current && def ? (
              <VfxEditor
                key={current}
                gameId={id}
                id={current}
                def={def}
                effects={statuses}
                footer={
                  <>
                    <button type="button" onClick={() => create(copyVfx(def))}>
                      Duplicate
                    </button>
                    <ConfirmButton
                      className="danger"
                      confirmLabel="Confirm delete (status effects keep working)"
                      ms={3000}
                      onConfirm={async () => {
                        await deleteDoc(doc(db, "games", id, "vfx", current)).catch((e) => setMessage(friendlyError(e)));
                        setSelected(null);
                      }}
                    >
                      Delete
                    </ConfirmButton>
                  </>
                }
              />
            ) : (
              <div className="item-editor">
                <p className="muted">Pick a VFX to edit it, start a new one, or start from one of these:</p>
                <div className="vfx-templates">
                  {VFX_TEMPLATES.map((t) => {
                    const sample = t.make();
                    return (
                      <button key={t.key} type="button" className="vfx-template" onClick={() => create(sample)}>
                        <span className="vfx-stage small">
                          <span className="token player vfx-sample" style={motionStyle([{ def: sample, stacks: 6 }])}>
                            <VfxView def={sample} stacks={6} />
                          </span>
                        </span>
                        <span>{t.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="equip-list">
            <div className="row wrap library-filters">
              <input aria-label="Search" placeholder="Search VFX" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <ul className="plain effect-list">
              <li>
                <button type="button" className="equip-add-page library-new" onClick={() => create(blankVfx())}>
                  + New VFX
                </button>
              </li>
              {current && (
                <li>
                  <button type="button" className="vfx-back" onClick={() => setSelected(null)}>
                    Start from a ready-made look
                  </button>
                </li>
              )}
              {list.map(([key, raw]) => {
                const d = cleanVfx(raw);
                const names = d.statuses.map(statusName).filter(Boolean);
                return (
                  <li key={key}>
                    <button type="button" className={"effect-row vfx-row" + (key === current ? " selected" : "")} onClick={() => setSelected(key)}>
                      <span className="vfx-stage tiny">
                        <span className="token player vfx-sample">
                          <VfxView def={{ ...d, layers: d.layers.filter((l) => l.type !== "motion") }} stacks={6} />
                        </span>
                      </span>
                      <span className="vfx-row-text">
                        <strong>{d.name || "Unnamed"}</strong>
                        <span className="muted small">
                          {playLabel(d.play)} · {names.length ? `Plays on ${names.join(", ")}` : "Not on any status effect yet"}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {list.length === 0 && <p className="muted">No VFX {search.trim() ? "match" : "yet"}.</p>}
          </div>
        </div>
      </main>
    </>
  );
}
