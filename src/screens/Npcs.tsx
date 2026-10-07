import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, deleteDoc, doc, getDocs, query, setDoc, where, writeBatch } from "firebase/firestore";
import type { Character, ItemTemplate, NpcTemplate } from "../../shared/character.ts";
import { blankNpc, normalizeNpc, NPC_SIDES, npcStats } from "../../shared/ruleset.ts";
import type { GameDoc } from "../../shared/types.ts";
import { useAuth, useCollection, useDoc } from "../api.ts";
import { gearLibrary } from "../components/npc/GearLibrary.tsx";
import { NpcEditor } from "../components/npc/NpcEditor.tsx";
import { EffectLibraryContext, useLibraryValue } from "../components/effects/library.tsx";
import { TopBar } from "../components/TopBar.tsx";
import { db, friendlyError } from "../firebase.ts";

const EXPORT_FORMAT = "solp-characters";

const fileName = (s: string) => s.replace(/[^\w-]+/g, "_") || "characters";

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${fileName(name)}.json` });
  a.click();
  URL.revokeObjectURL(url);
}

/** Characters in an export file: one character, a list, or a full export. */
function charactersIn(data: unknown): NpcTemplate[] {
  const d = data as { characters?: unknown; format?: unknown } | unknown[] | null;
  const raw: unknown[] = Array.isArray(d) ? d : d && Array.isArray((d as { characters?: unknown }).characters) ? ((d as { characters: unknown[] }).characters) : d && typeof d === "object" && "name" in d ? [d] : [];
  return raw.filter((r) => r && typeof r === "object").map((r) => ({ ...normalizeNpc(r), updatedAt: Date.now() }));
}

async function addAll(gameId: string, list: NpcTemplate[]) {
  for (let i = 0; i < list.length; i += 400) {
    const batch = writeBatch(db);
    for (const t of list.slice(i, i + 400)) batch.set(doc(collection(db, "games", gameId, "enemies")), t);
    await batch.commit();
  }
}

/** A character in the list on the left: portrait, name, side and Health. */
function NpcPreview({ t, active, onClick }: { t: NpcTemplate; active: boolean; onClick: () => void }) {
  const side = NPC_SIDES.find((s) => s.value === t.side)!;
  return (
    <button type="button" className={"npc-preview" + (active ? " active" : "")} onClick={onClick} style={{ "--npc-color": t.color } as React.CSSProperties}>
      <span className="npc-portrait">{t.portrait ? <img src={t.portrait} alt="" /> : <span>{(t.name.trim() || "?")[0].toUpperCase()}</span>}</span>
      <span className="npc-preview-text">
        <strong>{t.name || "Unnamed"}</strong>
        <span className="muted small">
          <span className={`side-badge ${t.side}`}>{side.label}</span> Rank {t.rank} · {npcStats(t).maxHp} HP
        </span>
      </span>
    </button>
  );
}

/**
 * The GM's characters: enemies, allies and anyone else. Build one like a player's character (Rank,
 * Stats, Augment, Weapons, Armor, deck, inventory), reusing gear already made in the game, then
 * place copies from the GM screen. Characters can be exported, imported, and copied between games.
 */
export function Npcs() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const game = useDoc<GameDoc>(`games/${id}`);
  const isGm = !!user && game.data?.gmId === user.id;
  const effects = useLibraryValue(isGm ? id : "", user?.id, isGm);
  const raw = useCollection<NpcTemplate>(isGm ? `games/${id}/enemies` : null);
  const players = useCollection<Character>(isGm ? `games/${id}/characters` : null);
  const items = useCollection<ItemTemplate>(isGm ? `games/${id}/items` : null);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [otherGames, setOtherGames] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!user) return;
    getDocs(query(collection(db, "games"), where("memberIds", "array-contains", user.id)))
      .then((snap) => setOtherGames(snap.docs.filter((d) => d.id !== id && (d.data() as GameDoc).gmId === user.id).map((d) => ({ id: d.id, name: (d.data() as GameDoc).name }))))
      .catch(() => setOtherGames([]));
  }, [user, id]);

  const npcs = useMemo(() => Object.fromEntries(Object.entries(raw ?? {}).map(([k, v]) => [k, normalizeNpc(v)])), [raw]);
  const list = Object.entries(npcs)
    .filter(([, t]) => t.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => a[1].name.localeCompare(b[1].name));
  const current = selected && npcs[selected] ? selected : null;
  // Gear from every other character in the game, to reuse.
  const gear = useMemo(
    () =>
      gearLibrary([
        ...Object.entries(npcs)
          .filter(([k]) => k !== current)
          .map(([, c]) => ({ from: c.name || "Unnamed", c })),
        ...Object.values(players ?? {}).map((c) => ({ from: c.name || "a player", c })),
      ]),
    [npcs, players, current],
  );

  if (game.loading) return <main className="center muted">Loading…</main>;
  if (!isGm) {
    return (
      <>
        <TopBar />
        <main className="center">
          <p className="error">Only the GM can see these characters.</p>
          <Link to={`/games/${id}`}>Back to the game</Link>
        </main>
      </>
    );
  }

  const create = async (t: NpcTemplate) => {
    try {
      const ref = doc(collection(db, "games", id, "enemies"));
      await setDoc(ref, { ...t, updatedAt: Date.now() });
      setSelected(ref.id);
    } catch (err) {
      setMessage(friendlyError(err));
    }
  };
  const importFile = async (file: File) => {
    try {
      const found = charactersIn(JSON.parse(await file.text()));
      if (!found.length) return setMessage("No characters found in that file.");
      await addAll(id, found);
      setMessage(`Imported ${found.length} character${found.length === 1 ? "" : "s"}.`);
    } catch (err) {
      setMessage(err instanceof SyntaxError ? "That file isn't a character export." : friendlyError(err));
    }
  };
  const copyFrom = async (gameId: string) => {
    if (!gameId) return;
    try {
      const snap = await getDocs(collection(db, "games", gameId, "enemies"));
      const found = snap.docs.map((d) => ({ ...normalizeNpc(d.data()), updatedAt: Date.now() }));
      if (!found.length) return setMessage("That game has no characters.");
      await addAll(id, found);
      setMessage(`Copied ${found.length} character${found.length === 1 ? "" : "s"} from ${otherGames.find((g) => g.id === gameId)?.name ?? "the other game"}.`);
    } catch (err) {
      setMessage(friendlyError(err));
    }
  };
  const exportOne = (t: NpcTemplate) => download(t.name || "character", { format: EXPORT_FORMAT, version: 1, characters: [t] });
  const exportAll = () => download(`${game.data!.name}-characters`, { format: EXPORT_FORMAT, version: 1, game: game.data!.name, characters: Object.values(npcs) });

  return (
    <EffectLibraryContext.Provider value={effects}>
      <TopBar />
      <main className="npcs">
        <header className="sheet-header">
          <Link to={`/games/${id}`} className="muted">
            ← {game.data!.name}
          </Link>
          <h1>Characters</h1>
          <p className="muted">Enemies, allies and everyone else in your story. Build one once, then place as many copies as you need from the GM screen; each copy has its own Health, Light and deck.</p>
          <div className="row wrap items-actions">
            <button type="button" onClick={exportAll} disabled={list.length === 0}>
              Export all
            </button>
            <label className="button-like">
              Import
              <input type="file" accept="application/json,.json" hidden aria-label="Import characters file" onChange={(e) => (e.target.files?.[0] && importFile(e.target.files[0]), (e.target.value = ""))} />
            </label>
            {otherGames.length > 0 && (
              <select aria-label="Copy characters from another game" value="" onChange={(e) => copyFrom(e.target.value)}>
                <option value="">Copy characters from another game…</option>
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
        </header>

        <aside className="npc-list" aria-label="Your characters">
          <button type="button" className="big-button" onClick={() => create({ ...blankNpc(), name: "New character" })}>
            + New character
          </button>
          <input aria-label="Search characters" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
          {raw === undefined && <p className="muted">Loading…</p>}
          {raw && Object.keys(raw).length === 0 && <p className="muted small">No characters yet. Make one, or import some.</p>}
          {list.map(([tid, t]) => (
            <NpcPreview key={tid} t={t} active={tid === current} onClick={() => setSelected(tid)} />
          ))}
        </aside>

        <section className="npc-main">
          {current ? (
            <NpcEditor
              key={current}
              gameId={id}
              id={current}
              template={npcs[current]}
              gear={gear}
              items={items}
              onExport={exportOne}
              onDuplicate={(t) => create({ ...structuredClone(t), name: `${t.name || "Unnamed"} (copy)` })}
              onDelete={async () => {
                if (!confirm("Delete this character? Copies already on the map stay.")) return;
                // Close the editor first, so its last save lands before the delete.
                setSelected(null);
                await new Promise((r) => setTimeout(r));
                await deleteDoc(doc(db, "games", id, "enemies", current)).catch((err) => setMessage(friendlyError(err)));
              }}
            />
          ) : (
            <p className="muted npc-empty">Pick a character on the left to edit it, or make a new one.</p>
          )}
        </section>
      </main>
    </EffectLibraryContext.Provider>
  );
}
