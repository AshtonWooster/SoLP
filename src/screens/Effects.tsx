import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { collection, deleteDoc, doc, setDoc, updateDoc } from "firebase/firestore";
import { blankEffect, cleanEffect, copyEffect, EFFECT_KINDS, effectLibrary, isLive, isPreset, type EffectDef, type EffectKind } from "../../shared/effects.ts";
import { type GameDoc, playersCanCreateEffects } from "../../shared/types.ts";
import { useAuth, useCollection, useDoc } from "../api.ts";
import { EffectBuilder, effectText } from "../components/effects/EffectBuilder.tsx";
import { TopBar } from "../components/TopBar.tsx";
import { db, friendlyError } from "../firebase.ts";

const SAVE_DELAY_MS = 500;

/** Edits one of the game's effects, saving shortly after each change. */
function DefEditor({
  gameId,
  id,
  def,
  library,
  isGm,
  mayAutomate,
}: {
  gameId: string;
  id: string;
  def: EffectDef;
  library: Record<string, EffectDef>;
  isGm: boolean;
  mayAutomate: boolean;
}) {
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
    // Without "Players can create effects", a player's entry stays words only.
    if (!mayAutomate) next = { ...next, rules: [] };
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
      <EffectBuilder def={d} library={{ ...library, [id]: d }} onChange={update} mayAutomate={mayAutomate} />
    </div>
  );
}

/** Waiting on the GM: a player's automated entry the GM hasn't approved. Words-only entries never wait. */
const waiting = (d: EffectDef) => d.rules.length > 0 && !isLive(d);
const kindOf = (k: string | null): EffectKind => EFFECT_KINDS.find((x) => x.value === k)?.value ?? "status";

/**
 * The effect library, one tab per kind: Status effects (Burn, Poise…), Passives, Proficiencies and
 * Dice effects, built from menus. Everyone in the game shares it. The GM edits it; players can add
 * Passives and Proficiencies in words, and automate them (with GM approval) when the GM allows.
 */
export function Effects() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const game = useDoc<GameDoc>(`games/${id}`);
  const isGm = !!user && game.data?.gmId === user.id;
  const member = !!user && !!game.data?.members[user.id];
  const mayAutomate = isGm || (member && playersCanCreateEffects(game.data));
  const [params, setParams] = useSearchParams();
  const kind = kindOf(params.get("kind"));
  const setKind = (k: EffectKind) => setParams({ kind: k }, { replace: true });
  // Anyone may add a Passive or Proficiency in words; Status and Dice effects need rules.
  const mayCreate = mayAutomate || (member && (kind === "passive" || kind === "proficiency"));
  const own = useCollection<EffectDef>(member ? `games/${id}/effects` : null);
  const library = useMemo(() => effectLibrary(own), [own]);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [onlyWaiting, setOnlyWaiting] = useState(false);
  const [message, setMessage] = useState("");

  const list = useMemo(
    () =>
      Object.entries(library)
        .filter(([, d]) => d.kind === kind && (!onlyWaiting || waiting(d)) && d.name.toLowerCase().includes(search.trim().toLowerCase()))
        .sort((a, b) => Number(isPreset(b[0])) - Number(isPreset(a[0])) || a[1].name.localeCompare(b[1].name)),
    [library, kind, search, onlyWaiting],
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
    const def = from ? copyEffect(from, `${from.name} (variant)`) : { ...blankEffect(kind), name: `New ${info.label}` };
    if (!mayAutomate) def.rules = [];
    try {
      await setDoc(ref, cleanEffect({ ...def, updatedAt: Date.now(), ...(isGm ? {} : { createdBy: user!.id, approved: false }) }));
      setSelected(ref.id);
    } catch (err) {
      setMessage(friendlyError(err));
    }
  };
  const info = EFFECT_KINDS.find((k) => k.value === kind)!;
  const current = selected && library[selected]?.kind === kind ? selected : null;
  const def = current ? library[current] : undefined;
  const mayEdit = (key: string, d: EffectDef) => !isPreset(key) && (isGm || d.createdBy === user!.id);
  const mayVariant = (d: EffectDef) => mayAutomate || ((d.kind === "passive" || d.kind === "proficiency") && d.rules.length === 0);
  const waitingCount = (k: EffectKind) => Object.values(own ?? {}).filter((d) => d.kind === k && waiting(d)).length;
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
              ? "Everything shared in this game: Status effects, Passives, Proficiencies and Dice effects. Automate any of them from menus: when it happens, any checks, and what it does. Sheets pick them from menus."
              : mayAutomate
                ? "Everything shared in this game. Your GM lets players automate entries: build one from menus and it works at the table once your GM approves it."
                : "Everything shared in this game. You can add Passives and Proficiencies in words; your GM can let players automate them in Game settings."}
          </p>
          {message && (
            <p className="muted" role="status">
              {message}
            </p>
          )}
        </header>

        <nav className="tabs effect-tabs" role="tablist" aria-label="Kinds">
          {EFFECT_KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              role="tab"
              aria-selected={kind === k.value}
              className={"tab" + (kind === k.value ? " active" : "")}
              onClick={() => {
                setKind(k.value);
                setOnlyWaiting(false);
              }}
            >
              {k.plural}
              {waitingCount(k.value) > 0 && <span className="tab-badge">{waitingCount(k.value)}</span>}
            </button>
          ))}
        </nav>

        <div className="equip-studio items-studio effects-studio">
          <div className="equip-editor">
            {current && def && mayEdit(current, def) ? (
              <>
                <DefEditor key={current} gameId={id} id={current} def={def} library={library} isGm={isGm} mayAutomate={mayAutomate} />
                <div className="row wrap">
                  {isGm && def.createdBy && def.rules.length > 0 && (
                    <button
                      type="button"
                      className={def.approved ? "" : "chip go"}
                      onClick={() => updateDoc(doc(db, "games", id, "effects", current), { approved: !def.approved }).catch((e) => setMessage(friendlyError(e)))}
                    >
                      {def.approved ? "Withdraw approval" : `Approve ${maker(def)}'s effect`}
                    </button>
                  )}
                  {mayVariant(def) && (
                    <button type="button" onClick={() => create(def)}>
                      Make a variant
                    </button>
                  )}
                  <button
                    type="button"
                    className="danger"
                    onClick={async () => {
                      if (!confirm(`Delete ${def.name || "this entry"}? Sheets that have it keep its words.`)) return;
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
                  <span className="muted small">
                    {info.label}
                    {def.kind === "passive" ? ` · Cost ${def.cost ?? 0}` : ""}
                  </span>
                  <p>{effectText(def, library)}</p>
                </div>
                <p className="muted small">{isPreset(current) ? "Built in. Make a variant to change it." : `Made by ${maker(def)}. Only they and the GM can change it.`}</p>
                {mayVariant(def) && (
                  <button type="button" onClick={() => create(def)}>
                    Make a variant
                  </button>
                )}
              </div>
            ) : (
              <p className="muted equip-empty">
                Pick one of the {info.plural.toLowerCase()} to see it{mayCreate ? ", or make a new one" : ""}. {info.hint}.
              </p>
            )}
          </div>
          <div className="equip-list">
            <div className="row wrap library-filters">
              <input aria-label="Search" placeholder={`Search ${info.plural.toLowerCase()}`} value={search} onChange={(e) => setSearch(e.target.value)} />
              {waitingCount(kind) > 0 && (
                <button type="button" className={"chip" + (onlyWaiting ? " active" : "")} onClick={() => setOnlyWaiting(!onlyWaiting)}>
                  Waiting for approval ({waitingCount(kind)})
                </button>
              )}
            </div>
            <ul className="plain effect-list">
              {mayCreate && (
                <li>
                  <button type="button" className="equip-add-page library-new" onClick={() => create()}>
                    + New {info.label}
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
                        {waiting(d) && <span className="chip static warn">Waiting for approval</span>}
                        {d.kind === "passive" && <span className="chip static">Cost {d.cost ?? 0}</span>}
                        {d.kind !== "status" && <span className="chip static">{d.rules.length ? "Automated" : "Words only"}</span>}
                      </span>
                    </span>
                    <span className="muted small">{effectText(d, library)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {list.length === 0 && <p className="muted">No {info.plural.toLowerCase()} {search.trim() ? "match" : "yet"}.</p>}
          </div>
        </div>
      </main>
    </>
  );
}
