import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { collection, deleteDoc, doc, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { blankEffect, cleanEffect, copyEffect, EFFECT_KINDS, effectLibrary, isLive, isPreset, type EffectDef, type EffectKind } from "../../shared/effects.ts";
import { type GameDoc, playersCanCreateEffects, proficienciesNeedApproval } from "../../shared/types.ts";
import { emptyStatFilter, matchesStatFilter, placeholderTree, type StatFilter } from "../../shared/proficiencies.ts";
import { ProficiencyTree, StatFilterBar, TreeLegend } from "../components/effects/ProficiencyTree.tsx";
import { RequirementList } from "../components/effects/library.tsx";
import { useAuth, useCollection, useDoc } from "../api.ts";
import { EffectBuilder, effectText } from "../components/effects/EffectBuilder.tsx";
import { TopBar } from "../components/TopBar.tsx";
import { db, friendlyError } from "../firebase.ts";
import { ConfirmButton } from "../components/ConfirmButton.tsx";
import { StatusVfxPicker } from "../components/vfx/StatusVfxPicker.tsx";
import { useVfxLibrary } from "../components/vfx/useVfx.ts";
import { StableLabel } from "../components/StableLabel.tsx";
import { ImageUpload } from "../components/ImageUpload.tsx";
import { LibraryStatusIcon } from "../components/effects/StatusIcons.tsx";

const SAVE_DELAY_MS = 500;

/** Edits one of the game's effects, saving shortly after each change. */
function DefEditor({
  gameId,
  id,
  def,
  library,
  isGm,
  autoApprove,
  approveProficiencies,
  footer,
}: {
  gameId: string;
  id: string;
  def: EffectDef;
  library: Record<string, EffectDef>;
  isGm: boolean;
  /** "Players can create effects" is on: a player's changes work without the GM's approval. */
  autoApprove: boolean;
  /** "Approve changes to the Proficiency tree" is on: a player's Proficiency waits for the GM after every change. */
  approveProficiencies: boolean;
  footer?: React.ReactNode;
}) {
  const { user } = useAuth();
  const [d, setD] = useState(def);
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) setD(def);
  }, [def]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const update = (next: EffectDef) => {
    // A player's change needs the GM's approval again, unless the GM lets players make effects.
    if (!isGm && next.createdBy) {
      const pending = approveProficiencies && (next.kind === "proficiency" || def.kind === "proficiency");
      next = { ...next, approved: autoApprove && !pending, pending };
    }
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
      {d.kind === "status" && (
        // The picture on its icon at the table; without one it gets a glyph or its initials.
        <div className="effect-icon-field">
          <span className="muted small">Icon</span>
          <LibraryStatusIcon id={id} def={d} size={44} />
          <ImageUpload
            folder={isGm ? `games/${gameId}/assets/effect-icons` : `games/${gameId}/users/${user?.id}/effect-icons`}
            kind="statusIcon"
            label="Icon"
            value={d.icon}
            onChange={(icon) => update(icon ? { ...d, icon } : (({ icon: _i, ...rest }) => rest)(d))}
          />
        </div>
      )}
      <EffectBuilder def={d} library={{ ...library, [id]: d }} selfId={id} onChange={update} footer={footer} />
    </div>
  );
}

type View = "tree" | "list";

/** Proficiencies: the skill tree, or the plain list every kind has. */
function ViewToggle({ view, setView }: { view: View; setView: (v: View) => void }) {
  return (
    <div className="row view-toggle" role="group" aria-label="View">
      {(["tree", "list"] as const).map((v) => (
        <button key={v} type="button" className={"chip" + (view === v ? " active" : "")} aria-pressed={view === v} onClick={() => setView(v)}>
          {v === "tree" ? "Tree" : "List"}
        </button>
      ))}
    </div>
  );
}

/**
 * Waiting on the GM: a player's automated entry the GM hasn't approved (words-only entries never
 * wait), or a player's Proficiency pending under "Approve changes to the Proficiency tree".
 */
const waiting = (d: EffectDef) => d.pending === true || ((d.rules.length > 0 || !!d.page) && !isLive(d));
const kindOf = (k: string | null): EffectKind => EFFECT_KINDS.find((x) => x.value === k)?.value ?? "status";

/**
 * The effect library, one tab per kind: Status effects (Burn, Poise…), Passives, Proficiencies and
 * Dice effects, built from menus. Everyone in the game shares it. The GM edits it; players add their
 * own, which need the GM's approval to work at the table unless the GM turned on "Players can create effects".
 */
export function Effects() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const game = useDoc<GameDoc>(`games/${id}`);
  const isGm = !!user && game.data?.gmId === user.id;
  const member = !!user && !!game.data?.members[user.id];
  // Players' effects work right away when the GM lets players make effects; otherwise they wait for approval.
  const autoApprove = isGm || playersCanCreateEffects(game.data);
  const approveProficiencies = proficienciesNeedApproval(game.data);
  // Proficiencies show as a skill tree by default; the list is a tap away.
  const [view, setView] = useState<View>("tree");
  const [statFilter, setStatFilter] = useState<StatFilter>(emptyStatFilter);
  const [params, setParams] = useSearchParams();
  const kind = kindOf(params.get("kind"));
  const setKind = (k: EffectKind) => setParams({ kind: k }, { replace: true });
  const own = useCollection<EffectDef>(member ? `games/${id}/effects` : null);
  const library = useMemo(() => effectLibrary(own), [own]);
  // The GM picks status effects' VFX here too (src/screens/Vfx.tsx).
  const vfx = useVfxLibrary(isGm ? id : null);
  const hasVfx = useMemo(() => new Set(Object.values(vfx ?? {}).flatMap((v) => v.statuses ?? [])), [vfx]);
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
    const pending = !isGm && approveProficiencies && def.kind === "proficiency";
    try {
      await setDoc(ref, cleanEffect({ ...def, updatedAt: Date.now(), ...(isGm ? {} : { createdBy: user!.id, approved: autoApprove && !pending, pending }) }));
      setSelected(ref.id);
    } catch (err) {
      setMessage(friendlyError(err));
    }
  };
  // The GM's starter tree: placeholder Proficiencies to rename, change or delete.
  const addPlaceholders = async () => {
    const batch = writeBatch(db);
    for (const [key, d] of Object.entries(placeholderTree(() => doc(collection(db, "games", id, "effects")).id))) {
      batch.set(doc(db, "games", id, "effects", key), cleanEffect({ ...d, updatedAt: Date.now() }));
    }
    try {
      await batch.commit();
      setMessage("Added 10 placeholder Proficiencies. Rename, change or delete any of them.");
    } catch (err) {
      setMessage(friendlyError(err));
    }
  };
  const info = EFFECT_KINDS.find((k) => k.value === kind)!;
  const treeView = kind === "proficiency" && view === "tree";
  const current = selected && library[selected]?.kind === kind ? selected : null;
  const def = current ? library[current] : undefined;
  const mayEdit = (key: string, d: EffectDef) => !isPreset(key) && (isGm || d.createdBy === user!.id);
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
              : autoApprove
                ? "Everything shared in this game. Make your own and automate them from menus: your GM lets players' effects work at the table right away."
                : "Everything shared in this game. Make your own and automate them from menus: an automated one works at the table once your GM approves it."}
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

        {treeView && (
          <section className="prof-tree-panel" aria-label="Proficiency tree">
            <div className="row-between wrap">
              <h2>Proficiency tree</h2>
              <ViewToggle view={view} setView={setView} />
            </div>
            <p className="muted small">
              Each player picks 2 Proficiencies at Rank 9 and 2 more at each Rank Up. A Proficiency can need others first and minimum Stats.
              {approveProficiencies ? (isGm ? " Players' new and changed Proficiencies wait for your approval." : " Your GM approves new and changed Proficiencies before anyone can pick them.") : ""}
            </p>
            <StatFilterBar
              filter={statFilter}
              onChange={setStatFilter}
              matches={Object.values(library).filter((d) => d.kind === "proficiency" && matchesStatFilter(d, statFilter)).length}
              total={Object.values(library).filter((d) => d.kind === "proficiency").length}
            />
            <ProficiencyTree
              filter={statFilter}
              library={library}
              stateOf={(_, d) => (d.pending ? "pending" : "plain")}
              selected={current}
              onSelect={(key) => {
                setSelected(key);
                // The editor is under the tree: bring it into view.
                requestAnimationFrame(() => document.querySelector(".effects-studio .equip-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }));
              }}
              empty={
                isGm ? (
                  <>
                    <p>No Proficiencies yet.</p>
                    <button type="button" className="chip go" onClick={addPlaceholders}>
                      Add placeholder Proficiencies
                    </button>
                  </>
                ) : (
                  "No Proficiencies yet. Add the first one."
                )
              }
            />
            <TreeLegend />
            <div className="row wrap">
              <button type="button" className="chip go" onClick={() => create()}>
                + New Proficiency
              </button>
              {isGm && list.length > 0 && (
                <button type="button" onClick={addPlaceholders}>
                  Add placeholder Proficiencies
                </button>
              )}
            </div>
          </section>
        )}

        <div className={"equip-studio items-studio effects-studio" + (treeView ? " tree-mode" : "")}>
          <div className="equip-editor">
            {current && def && mayEdit(current, def) ? (
              <DefEditor
                key={current}
                gameId={id}
                id={current}
                def={def}
                library={library}
                isGm={isGm}
                autoApprove={autoApprove}
                approveProficiencies={approveProficiencies}
                footer={
                <>
                  {isGm && def.kind === "status" && <StatusVfxPicker gameId={id} statusId={current} library={vfx} />}
                  {isGm && def.pending && (
                    <button
                      type="button"
                      className="chip go"
                      onClick={() => updateDoc(doc(db, "games", id, "effects", current), { pending: false, approved: true }).catch((e) => setMessage(friendlyError(e)))}
                    >
                      Approve {maker(def)}'s change to the tree
                    </button>
                  )}
                  {isGm && def.createdBy && !def.pending && (def.rules.length > 0 || !!def.page) && (
                    <button
                      type="button"
                      className={def.approved ? "" : "chip go"}
                      onClick={() => updateDoc(doc(db, "games", id, "effects", current), { approved: !def.approved }).catch((e) => setMessage(friendlyError(e)))}
                    >
                      <StableLabel labels={[`Approve ${maker(def)}'s effect`, "Withdraw approval"]} show={def.approved ? 1 : 0} />
                    </button>
                  )}
                  <button type="button" onClick={() => create(def)}>
                    Make a variant
                  </button>
                  {/* Removing an approved effect is a change too: only the GM can, unless players' effects need no approval. */}
                  {isGm || (approveProficiencies && def.kind === "proficiency" ? def.pending : autoApprove || !def.approved) ? (
                    <ConfirmButton
                      className="danger"
                      confirmLabel="Delete?"
                      confirmHint="Sheets keep its words"
                      ms={3000}
                      onConfirm={async () => {
                        await deleteDoc(doc(db, "games", id, "effects", current)).catch((e) => setMessage(friendlyError(e)));
                        setSelected(null);
                      }}
                    >
                      Delete
                    </ConfirmButton>
                  ) : (
                    <span className="muted small">Approved by your GM: ask them to delete it.</span>
                  )}
                </>
                }
              />
            ) : current && def ? (
              <div className="item-editor">
                <div className="effect-card">
                  <strong>{def.name}</strong>
                  <span className="muted small">
                    {info.label}
                    {def.kind === "passive" ? ` · Cost ${def.cost ?? 0}` : ""}
                  </span>
                  <p>{effectText(def, library)}</p>
                  {def.kind === "proficiency" && <RequirementList def={def} library={library} />}
                  {def.page && <p className="small">Adds the Page <strong>{def.page.name || "Unnamed"}</strong> to the Auxiliary Deck.</p>}
                </div>
                <p className="muted small">{isPreset(current) ? "Built in. Make a variant to change it." : `Made by ${maker(def)}. Only they and the GM can change it.`}</p>
                <button type="button" onClick={() => create(def)}>
                  Make a variant
                </button>
                {isGm && def.kind === "status" && <StatusVfxPicker gameId={id} statusId={current} library={vfx} />}
              </div>
            ) : (
              <p className="muted equip-empty">
                Pick one of the {info.plural.toLowerCase()} to see it, or make a new one. {info.hint}.
              </p>
            )}
          </div>
          {!treeView && (
          <div className="equip-list">
            <div className="row wrap library-filters">
              {kind === "proficiency" && <ViewToggle view={view} setView={setView} />}
              <input aria-label="Search" placeholder={`Search ${info.plural.toLowerCase()}`} value={search} onChange={(e) => setSearch(e.target.value)} />
              {waitingCount(kind) > 0 && (
                <button type="button" className={"chip" + (onlyWaiting ? " active" : "")} onClick={() => setOnlyWaiting(!onlyWaiting)}>
                  Waiting for approval ({waitingCount(kind)})
                </button>
              )}
            </div>
            <ul className="plain effect-list">
              <li>
                <button type="button" className="equip-add-page library-new" onClick={() => create()}>
                  + New {info.label}
                </button>
              </li>
              {list.map(([key, d]) => (
                <li key={key}>
                  <button type="button" className={"effect-row" + (key === current ? " selected" : "")} onClick={() => setSelected(key)}>
                    <span className="row-between">
                      <span className="row">
                        {d.kind === "status" && <LibraryStatusIcon id={key} def={d} size={26} />}
                        <strong>{d.name || "Unnamed"}</strong>
                      </span>
                      <span className="row">
                        {isPreset(key) && <span className="chip static">Built in</span>}
                        {hasVfx.has(key) && <span className="chip static">VFX</span>}
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
          )}
        </div>
      </main>
    </>
  );
}
