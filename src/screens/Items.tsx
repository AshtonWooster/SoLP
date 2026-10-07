import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, deleteDoc, doc, getDocs, query, setDoc, where, writeBatch } from "firebase/firestore";
import type { InventoryItem, ItemTemplate } from "../../shared/character.ts";
import { blankTemplate, cleanTemplate, ITEM_KINDS } from "../../shared/ruleset.ts";
import { type GameDoc, playersCanCreateItems } from "../../shared/types.ts";
import { useAuth, useCollection, useDoc } from "../api.ts";
import { ItemCard, ItemCardEditor } from "../components/items/ItemCard.tsx";
import { TopBar } from "../components/TopBar.tsx";
import { db, friendlyError } from "../firebase.ts";

const SAVE_DELAY_MS = 500;
/** The file format for sharing an item library between games. */
const EXPORT_FORMAT = "solp-items";

/** Edits one library item, saving shortly after each change. */
function TemplateEditor({ gameId, id, template, onDeleted }: { gameId: string; id: string; template: ItemTemplate; onDeleted: () => void }) {
  const [t, setT] = useState(template);
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dirty = useRef(false);
  // Follow changes from elsewhere unless there are unsaved local edits.
  useEffect(() => {
    if (!dirty.current) setT(template);
  }, [template]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const update = (next: ItemTemplate) => {
    setT(next);
    dirty.current = true;
    setStatus("Saving…");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await setDoc(doc(db, "games", gameId, "items", id), cleanTemplate(next)!);
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
      <ItemCardEditor
        item={t}
        artFolder={`games/${gameId}/assets/items`}
        onChange={update}
        onRemove={async () => {
          clearTimeout(timer.current);
          await deleteDoc(doc(db, "games", gameId, "items", id));
          onDeleted();
        }}
      />
    </div>
  );
}

/** Adds items to this game's library in one write. */
async function addAll(gameId: string, items: ItemTemplate[]) {
  for (let i = 0; i < items.length; i += 400) {
    const batch = writeBatch(db);
    for (const t of items.slice(i, i + 400)) batch.set(doc(collection(db, "games", gameId, "items")), t);
    await batch.commit();
  }
}

/**
 * The GM's item library: every item players can put in their inventories. Items are game-specific;
 * export them to a file or copy them from another of your games to reuse them.
 */
export function Items() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const game = useDoc<GameDoc>(`games/${id}`);
  const isGm = !!user && game.data?.gmId === user.id;
  // Players can open the library too when the GM lets them make items (game settings).
  const canOpen = isGm || (!!user && !!game.data?.members[user.id] && playersCanCreateItems(game.data));
  const items = useCollection<ItemTemplate>(canOpen ? `games/${id}/items` : null);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<InventoryItem["kind"] | "all">("all");
  const [message, setMessage] = useState("");
  const [otherGames, setOtherGames] = useState<{ id: string; name: string }[]>([]);

  // Other games you GM, to copy items from.
  useEffect(() => {
    if (!user) return;
    getDocs(query(collection(db, "games"), where("memberIds", "array-contains", user.id)))
      .then((snap) => setOtherGames(snap.docs.filter((d) => d.id !== id && (d.data() as GameDoc).gmId === user.id).map((d) => ({ id: d.id, name: (d.data() as GameDoc).name }))))
      .catch(() => setOtherGames([]));
  }, [user, id]);

  const list = useMemo(
    () =>
      Object.entries(items ?? {})
        .filter(([, t]) => (kind === "all" || t.kind === kind) && t.name.toLowerCase().includes(search.trim().toLowerCase()))
        .sort((a, b) => a[1].name.localeCompare(b[1].name)),
    [items, kind, search],
  );

  if (game.loading) return <main className="center muted">Loading…</main>;
  if (!canOpen) {
    return (
      <>
        <TopBar />
        <main className="center">
          <p className="error">Only the GM can edit the item library.</p>
          <Link to={`/games/${id}`}>Back to the game</Link>
        </main>
      </>
    );
  }
  const current = selected && items?.[selected] ? selected : null;
  // The GM edits every item; a player only the ones they made.
  const mayEdit = (t: ItemTemplate) => isGm || t.createdBy === user!.id;
  const maker = (t: ItemTemplate) => (t.createdBy ? (game.data!.members[t.createdBy]?.displayName ?? "a former player") : "the GM");

  const create = async () => {
    const ref = doc(collection(db, "games", id, "items"));
    await setDoc(ref, { ...blankTemplate("item"), name: "New item", ...(isGm ? {} : { createdBy: user!.id }) }).catch((e) => setMessage(friendlyError(e)));
    setSelected(ref.id);
  };

  const exportItems = () => {
    const data = { format: EXPORT_FORMAT, version: 1, game: game.data!.name, items: Object.values(items ?? {}) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${game.data!.name.replace(/[^\w-]+/g, "_") || "items"}-items.json` });
    a.click();
    URL.revokeObjectURL(url);
  };

  const importFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      const raw: unknown[] = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
      const clean = raw.map(cleanTemplate).filter((t): t is ItemTemplate => !!t && !!t.name.trim()).map(({ createdBy: _by, ...t }) => t);
      if (!clean.length) return setMessage("No items found in that file.");
      await addAll(id, clean);
      setMessage(`Imported ${clean.length} item${clean.length === 1 ? "" : "s"}.`);
    } catch (err) {
      setMessage(err instanceof SyntaxError ? "That file isn't an item export." : friendlyError(err));
    }
  };

  const copyFrom = async (gameId: string) => {
    if (!gameId) return;
    try {
      const snap = await getDocs(collection(db, "games", gameId, "items"));
      const clean = snap.docs.map((d) => cleanTemplate(d.data())).filter((t): t is ItemTemplate => !!t).map(({ createdBy: _by, ...t }) => t);
      if (!clean.length) return setMessage("That game has no items.");
      await addAll(id, clean);
      setMessage(`Copied ${clean.length} item${clean.length === 1 ? "" : "s"} from ${otherGames.find((g) => g.id === gameId)?.name ?? "the other game"}.`);
    } catch (err) {
      setMessage(friendlyError(err));
    }
  };

  return (
    <>
      <TopBar />
      <main className="items-page">
        <header className="sheet-header">
          <Link to={`/games/${id}`} className="muted">
            ← {game.data!.name}
          </Link>
          <h1>Item library</h1>
          <p className="muted">
            {isGm
              ? "Make the items players can add to their inventories. Edits reach every inventory holding the item."
              : "Your GM lets players make items. Make new ones here, then add them from your Inventory. You can edit or delete the items you made."}
          </p>
          {isGm && (
          <div className="row wrap items-actions">
            <button type="button" onClick={exportItems} disabled={!items || Object.keys(items).length === 0}>
              Export items
            </button>
            <label className="button-like">
              Import items
              <input type="file" accept="application/json,.json" hidden aria-label="Import items file" onChange={(e) => (e.target.files?.[0] && importFile(e.target.files[0]), (e.target.value = ""))} />
            </label>
            {otherGames.length > 0 && (
              <select aria-label="Copy items from another game" value="" onChange={(e) => copyFrom(e.target.value)}>
                <option value="">Copy items from another game…</option>
                {otherGames.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
            {message && (
              <span className="muted" role="status">
                {message}
              </span>
            )}
          </div>
          )}
          {!isGm && message && (
            <p className="muted" role="status">
              {message}
            </p>
          )}
        </header>

        <div className="equip-studio items-studio">
          <div className="equip-editor">
            {current && mayEdit(items![current]) ? (
              <TemplateEditor key={current} gameId={id} id={current} template={{ ...blankTemplate(), ...items![current] }} onDeleted={() => setSelected(null)} />
            ) : current ? (
              <div className="item-editor">
                <ItemCard item={items![current]} />
                <p className="muted small">Made by {maker(items![current])}. Only they and the GM can change it.</p>
              </div>
            ) : (
              <p className="muted equip-empty">Pick an item to edit it, or make a new one.</p>
            )}
          </div>
          <div className="equip-list">
            <div className="row wrap library-filters">
              <input aria-label="Search items" placeholder="Search items" value={search} onChange={(e) => setSearch(e.target.value)} />
              {(["all", ...ITEM_KINDS.map((k) => k.value)] as const).map((k) => (
                <button key={k} type="button" className={"chip" + (kind === k ? " active" : "")} onClick={() => setKind(k)}>
                  {k === "all" ? "All" : ITEM_KINDS.find((x) => x.value === k)!.label}
                </button>
              ))}
            </div>
            <div className="library-grid">
              <button type="button" className="equip-add-page library-new" onClick={create}>
                + New item
              </button>
              {list.map(([tid, t]) => (
                <ItemCard key={tid} item={t} size="thumb" selected={tid === current} onClick={() => setSelected(tid)} />
              ))}
            </div>
            {items && list.length === 0 && Object.keys(items).length > 0 && <p className="muted">No items match.</p>}
          </div>
        </div>
      </main>
    </>
  );
}
