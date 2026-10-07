import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, deleteDoc, doc, setDoc, updateDoc } from "firebase/firestore";
import { blankEffect, cleanEffect, copyEffect, effectLibrary, isLive, isPreset, type EffectDef } from "../../shared/effects.ts";
import { type GameDoc, playersCanCreateEffects } from "../../shared/types.ts";
import { useAuth, useCollection, useDoc } from "../api.ts";
import { EffectBuilder, effectText } from "../components/effects/EffectBuilder.tsx";
import { TopBar } from "../components/TopBar.tsx";
import { db, friendlyError } from "../firebase.ts";

const SAVE_DELAY_MS = 500;

/** Edits one of the game's effects, saving shortly after each change. */
function DefEditor({ gameId, id, def, library, isGm }: { gameId: string; id: string; def: EffectDef; library: Record<string, EffectDef>; isGm: boolean }) {
  const [d, setD] = useState(def);
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) setD(def);
  }, [def]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const update = (next: EffectDef) => {
    // A player's change needs the GM's approval again.
    if (!isGm && next.createdBy) next = { ...next, approved: false };
    setD(next);
    dirty.current = true;
    setStatus("Saving…");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const clean = cleanEffect({ ...next, updatedAt: Date.now() });
        if (clean.createdBy && !clean.approved) clean.approved = false;
        await setDoc(doc(db, "games", gameId, "effects", id), clean);
        dirty.current = false;
        setStatus("Saved");
      } catch (err) {
        setStatus(friendlyError(err));
      }
    }, SAVE_DELAY_MS);
  };
  return (
    <div className="item-editor">
      <span className={"save-state " + (status === "Saved" ? "saved" : "")}>{status}</span>
      <EffectBuilder def={d} library={{ ...library, [id]: d }} onChange={update} />
    </div>
  );
}

/**
 * The effect library: automated Status effects (Burn, Poise…) and Passives, built from menus.
 * Everyone in the game can read it; the GM edits it, and players too when the GM allows.
 */
export function Effects() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const game = useDoc<GameDoc>(`games/${id}`);
  const isGm = !!user && game.data?.gmId === user.id;
  const member = !!user && !!game.data?.members[user.id];
  const mayCreate = isGm || (member && playersCanCreateEffects(game.data));
  const own = useCollection<EffectDef>(member ? `games/${id}/effects` : null);
  const library = useMemo(() => effectLibrary(own), [own]);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<EffectDef["kind"] | "all" | "waiting">("all");
  const [message, setMessage] = useState("");

  const list = useMemo(
    () =>
      Object.entries(library)
        .filter(([, d]) => (kind === "all" || (kind === "waiting" ? !isLive(d) : d.kind === kind)) && d.name.toLowerCase().includes(search.trim().toLowerCase()))
        .sort((a, b) => Number(isPreset(b[0])) - Number(isPreset(a[0])) || a[1].name.localeCompare(b[1].name)),
    [library, kind, search],
  );

  if (game.loading) return <main className="center muted">Loading…</main>;
  if (!member) {
    return (
      <>
        <TopBar />
        <main className="center">
          <p className="error">Only people in this game can see its effects.</p>
          <Link to="/">Back</Link>
        </main>
      </>
    );
  }
  const create = async (from?: EffectDef) => {
    const ref = doc(collection(db, "games", id, "effects"));
    const def = from ? copyEffect(from, `${from.name} (variant)`) : { ...blankEffect(), name: "New effect" };
    try {
      await setDoc(ref, cleanEffect({ ...def, updatedAt: Date.now(), ...(isGm ? {} : { createdBy: user!.id, approved: false }) }));
      setSelected(ref.id);
    } catch (err) {
      setMessage(friendlyError(err));
    }
  };
  const current = selected && library[selected] ? selected : null;
  const def = current ? library[current] : undefined;
  const mayEdit = (key: string, d: EffectDef) => !isPreset(key) && (isGm || (mayCreate && d.createdBy === user!.id));
  const maker = (d: EffectDef) => (d.createdBy ? (game.data!.members[d.createdBy]?.displayName ?? "a former player") : "the GM");

  return (
    <>
      <TopBar />
      <main className="items-page effects-page">
        <header className="sheet-header">
          <Link to={`/games/${id}`} className="muted">
            ← {game.data!.name}
          </Link>
          <h1>Effect library</h1>
          <p className="muted">
            {isGm
              ? "Automated Status effects and Passives. Build each one from menus: when it happens, any checks, and what it does. Give them to characters from the GM screen, or link Passives and Proficiencies to them on character sheets."
              : mayCreate
                ? "Your GM lets players make effects. Build one from menus, then link a Passive or Proficiency to it. It works at the table once your GM approves it."
                : "The automated effects in this game. Your GM can let players make their own in Game settings."}
          </p>
          {message && (
            <p className="muted" role="status">
              {message}
            </p>
          )}
        </header>

        <div className="equip-studio items-studio effects-studio">
          <div className="equip-editor">
            {current && def && mayEdit(current, def) ? (
              <>
                <DefEditor key={current} gameId={id} id={current} def={def} library={library} isGm={isGm} />
                <div className="row wrap">
                  {isGm && def.createdBy && (
                    <button
                      type="button"
                      className={def.approved ? "" : "chip go"}
                      onClick={() => updateDoc(doc(db, "games", id, "effects", current), { approved: !def.approved }).catch((e) => setMessage(friendlyError(e)))}
                    >
                      {def.approved ? "Withdraw approval" : `Approve ${maker(def)}'s effect`}
                    </button>
                  )}
                  <button type="button" onClick={() => create(def)}>
                    Make a variant
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={async () => {
                      if (!confirm(`Delete ${def.name || "this effect"}? Characters that have it keep a plain note.`)) return;
                      await deleteDoc(doc(db, "games", id, "effects", current)).catch((e) => setMessage(friendlyError(e)));
                      setSelected(null);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </>
            ) : current && def ? (
              <div className="item-editor">
                <div className="effect-card">
                  <strong>{def.name}</strong>
                  <span className="muted small">{def.kind === "passive" ? "Passive" : "Status effect"}</span>
                  <p>{effectText(def, library)}</p>
                </div>
                <p className="muted small">{isPreset(current) ? "Built in. Make a variant to change it." : `Made by ${maker(def)}. Only they and the GM can change it.`}</p>
                {mayCreate && (
                  <button type="button" onClick={() => create(def)}>
                    Make a variant
                  </button>
                )}
              </div>
            ) : (
              <p className="muted equip-empty">Pick an effect to see it{mayCreate ? ", or make a new one" : ""}.</p>
            )}
          </div>
          <div className="equip-list">
            <div className="row wrap library-filters">
              <input aria-label="Search effects" placeholder="Search effects" value={search} onChange={(e) => setSearch(e.target.value)} />
              {(
                [
                  ["all", "All"],
                  ["status", "Status effects"],
                  ["passive", "Passives"],
                  ...(Object.values(own ?? {}).some((d) => !isLive(d)) ? [["waiting", "Waiting for approval"]] : []),
                ] as [typeof kind, string][]
              ).map(([k, label]) => (
                <button key={k} type="button" className={"chip" + (kind === k ? " active" : "")} onClick={() => setKind(k)}>
                  {label}
                </button>
              ))}
            </div>
            <ul className="plain effect-list">
              {mayCreate && (
                <li>
                  <button type="button" className="equip-add-page library-new" onClick={() => create()}>
                    + New effect
                  </button>
                </li>
              )}
              {list.map(([key, d]) => (
                <li key={key}>
                  <button type="button" className={"effect-row" + (key === current ? " selected" : "")} onClick={() => setSelected(key)}>
                    <span className="row-between">
                      <strong>{d.name || "Unnamed"}</strong>
                      <span className="row">
                        {isPreset(key) && <span className="chip static">Built in</span>}
                        {!isLive(d) && <span className="chip static warn">Waiting for approval</span>}
                        <span className="chip static">{d.kind === "passive" ? "Passive" : "Status"}</span>
                      </span>
                    </span>
                    <span className="muted small">{effectText(d, library)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {list.length === 0 && <p className="muted">No effects match.</p>}
          </div>
        </div>
      </main>
    </>
  );
}
