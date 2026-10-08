import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { GameDoc, GmMeta, Resources, TableAction, TableState, Token } from "../../shared/types.ts";
import { useAuth, useCollection, useDoc } from "../api.ts";
import { activeToken, newId } from "../../shared/engine.ts";
import { aimTargets, Grid } from "../components/Grid.tsx";
import { useClashPlayback } from "../components/ClashFx.tsx";
import { ActionPanel, PHASE_LABELS } from "../components/ActionPanel.tsx";
import { EnemyDeckEditor } from "../components/EnemyDeckEditor.tsx";
import { isMassAttack, normalizeNpc, NPC_SIDES, npcSpawnData } from "../../shared/ruleset.ts";
import type { NpcTemplate } from "../../shared/character.ts";
import { TurnOrder } from "../components/TurnOrder.tsx";
import { ConfirmButton } from "../components/ConfirmButton.tsx";
import { MapEditor } from "../components/maps/MapEditor.tsx";
import { MapList, MapPreview, NewMapForm } from "../components/maps/MapsList.tsx";
import { ConnectionBadge } from "../components/Status.tsx";
import { TableError } from "../components/TableError.tsx";
import { effectText } from "../components/effects/EffectBuilder.tsx";
import { useEffectLibrary } from "../components/effects/library.tsx";
import { isLive } from "../../shared/effects.ts";
import { useHost } from "../net/hooks.ts";
import { NumberField } from "../components/NumberField.tsx";

const RESOURCE_FIELDS: [keyof Resources, keyof Resources, string][] = [
  ["hp", "maxHp", "Health"],
  ["stagger", "maxStagger", "Stagger Resist"],
  ["light", "maxLight", "Light"],
  ["sanity", "maxSanity", "Sanity"],
];

/** The GM's laptop: runs the table and can override anything. */
export function Gm() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const game = useDoc<GameDoc>(`games/${id}`);
  const isGm = !!user && game.data?.gmId === user.id;
  const meta = useDoc<GmMeta>(isGm ? `games/${id}/gm/meta` : null);
  const { snapshot, host } = useHost(id, user, game.data);
  // The map shows clash damage once its die has played; the panels show the live values.
  const { step: fx, table: mapTable } = useClashPlayback(snapshot.table);
  const online = new Set(snapshot.online);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  // The map editor is its own tab. The GM's view there is theirs alone: players stay on the
  // table's map until the GM moves them.
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "maps" ? "maps" : "table";
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  if (game.error) return <TableError error={game.error} gameId={id} />;
  if (game.loading) return <main className="center muted">Loading…</main>;
  if (!isGm) return <TableError error="Only the GM can open this screen." gameId={id} />;

  if (snapshot.status === "replaced") {
    return <TableError error="This game is now being run from another GM screen. Close this one, or reload to take over here." gameId={id} />;
  }
  if (snapshot.status === "error") return <TableError error={snapshot.error ?? "Couldn't open the table."} gameId={id} />;

  /** Actions on the GM screen apply instantly in this tab; connected devices get the update. */
  const act = (action: TableAction): boolean => {
    try {
      host?.act(action);
      setActionError("");
      return true;
    } catch (err) {
      setActionError((err as Error).message);
      return false;
    }
  };

  const table = snapshot.table;
  const selected = selectedId ? table?.tokens[selectedId] : undefined;
  const players = Object.entries(game.data!.members).filter(([, m]) => m.role === "player");
  const setTab = (next: "table" | "maps") => {
    setActionError("");
    setParams(next === "maps" ? { tab: "maps" } : {}, { replace: true });
  };
  const editing = table && editingId && (editingId === table.map.id || table.maps?.[editingId]) ? editingId : table?.map.id ?? "";
  const openInEditor = (mapId: string) => {
    setEditingId(mapId);
    setPreviewId(null);
    setTab("maps");
  };

  const header = (
    <header className="gm-header">
      <Link to={`/games/${id}`} className="muted">← {game.data!.name}</Link>
      <nav className="gm-tabs" aria-label="GM screen">
        <button className={tab === "table" ? "on" : ""} aria-current={tab === "table" ? "page" : undefined} onClick={() => setTab("table")}>
          Table
        </button>
        <button className={tab === "maps" ? "on" : ""} aria-current={tab === "maps" ? "page" : undefined} onClick={() => setTab("maps")}>
          Map editor
        </button>
      </nav>
      <ConnectionBadge status={snapshot.status} />
      <a href={`/games/${id}/board`} target="_blank" rel="noreferrer">Open board</a>
      {meta.data && <span className="muted">Invite code: {meta.data.inviteCode}</span>}
      {actionError && <span className="error">{actionError}</span>}
    </header>
  );
  const preview = table && previewId && (
    <MapPreview table={table} mapId={previewId} act={act} onClose={() => setPreviewId(null)} onEdit={() => openInEditor(previewId)} />
  );

  if (tab === "maps") {
    const onTable = editing === table?.map.id;
    return (
      <main className="gm gm-maps">
        {header}
        {!table ? (
          <p className="muted">Opening the table…</p>
        ) : (
          <>
            <aside className="gm-maps-list">
              <h3>Maps</h3>
              <MapList table={table} editingId={editing} onPick={setPreviewId} />
              <NewMapForm act={act} onCreated={setEditingId} />
            </aside>
            <section className="gm-maps-editor">
              <div className={"me-banner" + (onTable ? " live" : "")}>
                {onTable ? (
                  <span>
                    <strong>Players are on this map.</strong> They see your changes as you make them, except anything hidden.
                  </span>
                ) : (
                  <>
                    <span>
                      Players are on <strong>{table.map.name}</strong>. You're getting <strong>{table.maps?.[editing]?.name}</strong> ready; they can't see it until you move them.
                    </span>
                    <button className="big-button" onClick={() => setPreviewId(editing)}>
                      Move players here…
                    </button>
                  </>
                )}
              </div>
              <MapEditor
                gameId={id}
                table={table}
                mapId={editing}
                act={act}
                onEditToken={(tokenId) => {
                  setSelectedId(tokenId);
                  setTab("table");
                }}
              />
            </section>
          </>
        )}
        {preview}
      </main>
    );
  }

  return (
    <main className="gm">
      {header}

      <section className="gm-map">
        {table && (
          <Grid
            state={mapTable ?? table}
            fx={fx}
            selectedId={selectedId}
            activeId={table.combat ? activeToken(table)?.id : undefined}
            onTokenClick={(t) => {
              // While a Page is being aimed, clicking a lit token targets it.
              const aim = table.combat?.aim;
              if (aim && aimTargets(table).targetable.has(t.id)) {
                const page = table.combat!.pages[aim.pageId] ?? table.tokens[aim.tokenId]?.pages?.find((p) => p.id === aim.pageId);
                act(page && isMassAttack(page.type) ? { type: "aimTarget", tokenId: t.id } : { type: "slot", targets: [t.id] });
                return;
              }
              setSelectedId(t.id === selectedId ? null : t.id);
            }}
            onCellClick={(x, y) => selectedId && act({ type: "move", tokenId: selectedId, x, y })}
          />
        )}
        <p className="muted">Click a token to select it, then click a tile to move it.</p>
      </section>

      <section className="gm-side">
        {table && (
          <details className="panel maps-panel">
            <summary>
              Maps <span className="muted small">· {table.map.name}</span>
            </summary>
            <p className="muted small">Pick a map to preview it before moving the players there.</p>
            <MapList table={table} onPick={setPreviewId} />
            <button onClick={() => setTab("maps")}>Open the map editor</button>
          </details>
        )}
        {table && <CombatPanel table={table} act={act} />}
        {table && <TemplatePanel gameId={id} table={table} act={act} />}
        <AddEnemy onAdd={(name) => act({ type: "addToken", name, side: "enemy", x: 10, y: 5 })} />
        {selected ? (
          <Override
            key={selected.id}
            token={selected}
            note={snapshot.notes[selected.id] ?? ""}
            act={act}
            onRemoved={() => setSelectedId(null)}
          />
        ) : (
          <p className="muted">Select a token to override its stats.</p>
        )}
        <h3>Players</h3>
        <ul className="plain">
          {players.length === 0 && <li className="muted">No players yet.</li>}
          {players.map(([uid, m]) => (
            <li key={uid}>
              {m.displayName} <span className={"dot " + (online.has(uid) ? "ok" : "bad")} />
            </li>
          ))}
        </ul>
        <h3>Log</h3>
        <ol className="log">
          {table?.log.slice(-15).reverse().map((line, i) => <li key={i}>{line}</li>)}
        </ol>
      </section>
      {preview}
    </main>
  );
}

function AddEnemy({ onAdd }: { onAdd: (name: string) => boolean }) {
  const [name, setName] = useState("");
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        if (onAdd(name || "Enemy")) setName("");
      }}
    >
      <input placeholder="Enemy name" value={name} onChange={(e) => setName(e.target.value)} />
      <button>Add enemy</button>
    </form>
  );
}

/** GM override panel: set any resource on any token directly. */
function Override({
  token,
  note,
  act,
  onRemoved,
}: {
  token: Token;
  note: string;
  act: (action: TableAction) => boolean;
  onRemoved: () => void;
}) {
  const { id: gameIdParam = "" } = useParams();
  const [notes, setNotes] = useState(note);
  useEffect(() => setNotes(note), [note]);

  const set = (key: keyof Resources, value: number) =>
    act({ type: "setResources", tokenId: token.id, patch: { [key]: value } });

  return (
    <div className="override">
      <h3>
        <span className="swatch" style={{ background: token.color }} /> {token.name}{" "}
        <span className="muted">({token.side})</span>
      </h3>
      {RESOURCE_FIELDS.map(([cur, max, label]) => (
        <div className="resource-row" key={cur}>
          <label>{label}</label>
          <button onClick={() => set(cur, token.resources[cur] - 1)}>−</button>
          <NumberField value={token.resources[cur]} onCommit={(n) => set(cur, n)} />
          <button onClick={() => set(cur, token.resources[cur] + 1)}>+</button>
          <span className="muted">/</span>
          <NumberField value={token.resources[max]} onCommit={(n) => set(max, n)} />
        </div>
      ))}
      <div className="resource-row">
        <label>Justice</label>
        {token.side === "player" && token.ownerId ? (
          <span className="muted small">{token.justice ?? 0}, from their character sheet</span>
        ) : (
          <NumberField value={token.justice ?? 0} onCommit={(n) => act({ type: "setJustice", tokenId: token.id, justice: n })} />
        )}
      </div>
      {token.ownerId && (
        <a href={`/games/${gameIdParam}/characters/${token.ownerId}?tab=inventory`} target="_blank" rel="noreferrer">
          Open character sheet, inventory and decks ↗
        </a>
      )}
      <h4>Resistances</h4>
      {token.side === "player" && token.ownerId ? (
        <p className="muted small">
          {token.resistances
            ? `Slash ×${token.resistances.slash}, Pierce ×${token.resistances.pierce}, Blunt ×${token.resistances.blunt}`
            : "×1 (no Armor)"}
          , from their Armor
          {token.staggerResistances &&
            `. Stagger: Slash ×${token.staggerResistances.slash}, Pierce ×${token.staggerResistances.pierce}, Blunt ×${token.staggerResistances.blunt}`}
        </p>
      ) : (
        <>
          {(["resistances", "staggerResistances"] as const).map((field) => (
            <div className="row wrap" key={field}>
              <span className="muted small">{field === "resistances" ? "Damage" : "Stagger"}</span>
              {(["slash", "pierce", "blunt"] as const).map((k) => (
                <label className="inline" key={k}>
                  {k[0].toUpperCase() + k.slice(1)} ×
                  <NumberField
                    value={token[field]?.[k] ?? 1}
                    onCommit={(n) => {
                      const base = { slash: 1, pierce: 1, blunt: 1 };
                      const res = { ...base, ...token.resistances };
                      const stag = { ...base, ...token.staggerResistances };
                      if (field === "resistances") res[k] = n;
                      else stag[k] = n;
                      act({ type: "setResistances", tokenId: token.id, resistances: res, staggerResistances: stag });
                    }}
                  />
                </label>
              ))}
            </div>
          ))}
        </>
      )}
      {token.side !== "player" && <EnemyDeck token={token} act={act} />}
      <EffectsEditor token={token} act={act} />
      <label className="muted">GM notes (hidden from players)</label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== note && act({ type: "setNote", tokenId: token.id, note: notes })}
      />
      <button
        className="danger"
        onClick={() => act({ type: "removeToken", tokenId: token.id }) && onRemoved()}
      >
        Remove token
      </button>
    </div>
  );
}

/** Start combat, run the turn order, and end combat. */
function CombatPanel({ table, act }: { table: TableState; act: (action: TableAction) => boolean }) {
  const tokens = Object.values(table.tokens);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState("");
  const combat = table.combat;

  if (!combat) {
    if (!picking) {
      return (
        <div className="combat-panel">
          <button
            className="big-button"
            onClick={() => {
              setPicked(new Set(tokens.map((t) => t.id)));
              setPicking(true);
            }}
          >
            Start combat
          </button>
        </div>
      );
    }
    return (
      <div className="combat-panel">
        <h3>Who's in this fight?</h3>
        <p className="muted small">Each rolls 1d6 + Justice for Speed.</p>
        <ul className="pick-list">
          {tokens.map((t) => (
            <li key={t.id}>
              <label>
                <input
                  type="checkbox"
                  checked={picked.has(t.id)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(t.id);
                    else next.delete(t.id);
                    setPicked(next);
                  }}
                />
                <span className="swatch" style={{ background: t.color }} /> {t.name}
                <span className="muted small">({t.side}, Justice {t.justice ?? 0})</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="row">
          <button
            className="big-button"
            disabled={picked.size === 0}
            onClick={() => act({ type: "startCombat", tokenIds: [...picked] }) && setPicking(false)}
          >
            Roll Speed and start
          </button>
          <button onClick={() => setPicking(false)}>Cancel</button>
        </div>
      </div>
    );
  }

  const outside = tokens.filter((t) => !combat.order.some((c) => c.tokenId === t.id));
  const active = activeToken(table);
  return (
    <div className="combat-panel">
      <div className="row-between">
        <h3>Combat · Round {combat.round}</h3>
        <ConfirmButton className="danger" confirmLabel="Confirm end combat" onConfirm={() => act({ type: "endCombat" })}>
          End combat
        </ConfirmButton>
      </div>
      {active && (
        <p className="muted small">
          {active.name}'s turn · {PHASE_LABELS[combat.phase]} · {combat.movementLeft} Movement left
        </p>
      )}
      {active && active.side !== "player" && <ActionPanel table={table} token={active} canAct send={(a) => void act(a)} />}
      {active?.side === "player" && combat.aim && (
        <p className="muted small">
          {active.name} is aiming {combat.pages[combat.aim.pageId]?.name}. Lit tokens can be clicked to target for them.
        </p>
      )}
      <TurnOrder
        table={table}
        controls={(tokenId, i) => (
          <>
            <button aria-label="Move up" disabled={i === 0} onClick={() => act({ type: "reorderCombatant", tokenId, dir: -1 })}>
              ↑
            </button>
            <button aria-label="Move down" disabled={i === combat.order.length - 1} onClick={() => act({ type: "reorderCombatant", tokenId, dir: 1 })}>
              ↓
            </button>
            <button aria-label="Remove from turn order" onClick={() => act({ type: "removeCombatant", tokenId })}>
              ✕
            </button>
          </>
        )}
      />
      <div className="row">
        <button className="big-button" onClick={() => act({ type: "endTurn" })}>
          Next turn
        </button>
        <button onClick={() => act({ type: "rerollSpeed" })}>Re-roll Speed</button>
      </div>
      {outside.length > 0 && (
        <div className="row">
          <select aria-label="Add to turn order" value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">Add to turn order…</option>
            {outside.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button disabled={!adding} onClick={() => act({ type: "addCombatant", tokenId: adding }) && setAdding("")}>
            Add
          </button>
        </div>
      )}
    </div>
  );
}

/** An enemy token's own Pages and deck (copied from its template, editable per token). */
function EnemyDeck({ token, act }: { token: Token; act: (action: TableAction) => boolean }) {
  return (
    <details className="enemy-pages">
      <summary>Pages and deck ({(token.pages ?? []).length} Pages)</summary>
      <EnemyDeckEditor
        pages={token.pages ?? []}
        deck={token.deck ?? []}
        onChange={(pages, deck) => act({ type: "setEnemyDeck", tokenId: token.id, pages, deck })}
      />
    </details>
  );
}

/** The GM's characters (enemies, allies and others), ready to place on the map. */
function TemplatePanel({ gameId, table, act }: { gameId: string; table: TableState; act: (action: TableAction) => boolean }) {
  const templates = useCollection<NpcTemplate>(`games/${gameId}/enemies`);
  const list = Object.entries(templates ?? {})
    .map(([tid, raw]) => [tid, normalizeNpc(raw)] as const)
    .sort((a, b) => a[1].name.localeCompare(b[1].name));
  const place = (templateId: string, t: NpcTemplate) =>
    act({ type: "spawnEnemy", templateId, template: npcSpawnData(t), x: t.side === "enemy" ? table.map.width - 3 : 2, y: Math.floor(table.map.height / 2) });
  return (
    <details className="combat-panel template-panel" open>
      <summary>
        <strong>Characters</strong>{" "}
        <a href={`/games/${gameId}/npcs`} target="_blank" rel="noreferrer" className="small">
          Manage ↗
        </a>
      </summary>
      {templates && list.length === 0 && <p className="muted small">None yet. Make some under Manage.</p>}
      <ul className="plain">
        {list.map(([tid, t]) => (
          <li key={tid}>
            <span>
              <span className="swatch" style={{ background: t.color }} /> {t.name || "Unnamed"}{" "}
              <span className="muted small">
                {NPC_SIDES.find((s) => s.value === t.side)?.label} · ×{Object.values(table.tokens).filter((x) => x.templateId === tid).length} on map
              </span>
            </span>
            <button onClick={() => place(tid, t)}>Place</button>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Effects on a character: automated ones from the effect library (with stacks), or notes tracked by hand. */
function EffectsEditor({ token, act }: { token: Token; act: (action: TableAction) => boolean }) {
  const { id = "" } = useParams();
  const library = useEffectLibrary(id);
  const effects = token.effects ?? [];
  const save = (next: typeof effects) => act({ type: "setEffects", tokenId: token.id, effects: next });
  const statuses = Object.entries(library).filter(([, d]) => d.kind === "status" && isLive(d));
  return (
    <details className="enemy-pages effects-editor">
      <summary>Effects ({effects.length})</summary>
      {effects.map((e, i) =>
        e.defId ? (
          <div className="effect-edit automated" key={e.id}>
            <div className="row">
              <strong className="effect-edit-name">
                {library[e.defId]?.name ?? e.name} <span className="chip static">Automated</span>
              </strong>
              <NumberField value={e.count} onCommit={(n) => save(effects.map((x, j) => (j === i ? { ...x, count: n } : x)).filter((x) => !x.defId || x.count > 0))} />
              <button type="button" className="icon" aria-label="Remove effect" onClick={() => save(effects.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
            <p className="muted small">{library[e.defId] ? effectText(library[e.defId], library) : `${e.description} (no longer in the effect library, so it does nothing)`}</p>
          </div>
        ) : (
          <div className="effect-edit" key={e.id}>
            <div className="row">
              <input aria-label="Effect name" placeholder="Effect" value={e.name} onChange={(ev) => save(effects.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)))} />
              <NumberField value={e.count} onCommit={(n) => save(effects.map((x, j) => (j === i ? { ...x, count: n } : x)))} />
              <button type="button" className="icon" aria-label="Remove effect" onClick={() => save(effects.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
            <input aria-label="Effect description" placeholder="What it does" value={e.description} onChange={(ev) => save(effects.map((x, j) => (j === i ? { ...x, description: ev.target.value } : x)))} />
            <input aria-label="Effect duration" placeholder="Duration (optional)" value={e.duration ?? ""} onChange={(ev) => save(effects.map((x, j) => (j === i ? { ...x, duration: ev.target.value } : x)))} />
          </div>
        ),
      )}
      <div className="row wrap">
        <select
          aria-label="Give an automated effect"
          value=""
          onChange={(ev) => {
            const defId = ev.target.value;
            const def = library[defId];
            if (!def) return;
            const have = effects.find((x) => x.defId === defId);
            save(have ? effects.map((x) => (x === have ? { ...x, count: x.count + 1 } : x)) : [...effects, { id: newId(), defId, name: def.name, count: 1, description: effectText(def, library) }]);
          }}
        >
          <option value="">+ Give an automated effect…</option>
          {statuses.map(([key, d]) => (
            <option key={key} value={key}>
              {d.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => save([...effects, { id: newId(), name: "", count: 1, description: "" }])}>
          + Add a note
        </button>
      </div>
    </details>
  );
}
