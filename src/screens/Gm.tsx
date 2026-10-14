import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { GameDoc, GmMeta, TableAction, TableState, Token } from "../../shared/types.ts";
import { useAuth, useCollection, useDoc, useStatFormulas } from "../api.ts";
import { activeToken } from "../../shared/engine.ts";
import { aimTargets, Grid } from "../components/Grid.tsx";
import { useClashPlayback } from "../components/ClashFx.tsx";
import { useSpeedRollPlayback } from "../components/SpeedRollFx.tsx";
import type { SpeedStep } from "../components/speedRoll.ts";
import { ActionPanel, PHASE_LABELS } from "../components/ActionPanel.tsx";
import { isMassAttack, normalizeNpc, NPC_SIDES, npcSpawnData } from "../../shared/ruleset.ts";
import type { Character, NpcTemplate } from "../../shared/character.ts";
import { playerList } from "../../shared/players.ts";
import { tokenGear } from "../../shared/tokenPreview.ts";
import { PlayerPreview } from "../components/PlayerPreview.tsx";
import { TokenPopup } from "../components/TokenPopup.tsx";
import { TurnOrder } from "../components/TurnOrder.tsx";
import { ConfirmButton } from "../components/ConfirmButton.tsx";
import { MapEditor, useSnap } from "../components/maps/MapEditor.tsx";
import { LayerSwitch } from "../components/maps/LayerSwitch.tsx";
import type { TableLayer } from "../../shared/maps.ts";
import { MapList, MapPreview, NewMapForm } from "../components/maps/MapsList.tsx";
import { MapView } from "../components/maps/MapView.tsx";
import { FogDraw, FogTools, type FogMode } from "../components/maps/Fog.tsx";
import { ConnectionBadge } from "../components/Status.tsx";
import { TableError } from "../components/TableError.tsx";
import { useHost } from "../net/hooks.ts";
import { useDrag } from "../components/drag.ts";
import { gmTurnToken } from "../../shared/combat.ts";
import { BLANK_DRAFT, GmPopups, type PopupDraft } from "../components/GmPopups.tsx";
import { upPopups } from "../../shared/popups.ts";
import { useStatusVfx } from "../components/vfx/useVfx.ts";
import { StableLabel } from "../components/StableLabel.tsx";

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
  // Speed rolls tumble on the map and the turn order deals out once they land.
  const speed = useSpeedRollPlayback(snapshot.table);
  // Status effect VFX, when they're on in Game settings.
  const vfx = useStatusVfx(isGm ? id : "", game.data);
  const online = new Set(snapshot.online);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  // The map editor is its own tab. The GM's view there is theirs alone: players stay on the
  // table's map until the GM moves them.
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "maps" ? "maps" : "table";
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  // Drawing fog of war over the table's map, when it's on in Game settings.
  const [fogMode, setFogMode] = useState<FogMode>(null);
  // Which layer clicks on the table's map work on: tokens as usual, or dragging assets or pins.
  const [layer, setLayer] = useState<TableLayer>("tokens");
  const [snap, setSnap] = useSnap();
  // Player characters (for the player list and their tokens' gear) and the GM's own characters.
  const characters = useCollection<Character>(isGm ? `games/${id}/characters` : null);
  const templates = useCollection<NpcTemplate>(isGm ? `games/${id}/enemies` : null);
  const formulas = useStatFormulas(id);
  // A GM character picked from the Characters menu, waiting for the GM to click a tile for it.
  const [placing, setPlacing] = useState<{ templateId: string; template: NpcTemplate } | null>(null);
  // A popup to players being written in the Popups menu, kept while the menu is closed.
  const [popupDraft, setPopupDraft] = useState<PopupDraft>(BLANK_DRAFT);
  useEffect(() => {
    if (!placing) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPlacing(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placing]);

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
  const players = playerList(id, game.data!, characters, true);
  // Finished popups stay in the menu's record but don't count as up.
  const popupsUp = table ? upPopups(table).length : 0;
  const setTab = (next: "table" | "maps") => {
    setActionError("");
    setParams(next === "maps" ? { tab: "maps" } : {}, { replace: true });
  };
  const editing = table && editingId && (editingId === table.map.id || table.maps?.[editingId]) ? editingId : (table?.map.id ?? "");
  const openInEditor = (mapId: string) => {
    setEditingId(mapId);
    setPreviewId(null);
    setTab("maps");
  };

  const header = (
    <header className="gm-header">
      <Link to={`/games/${id}`} className="muted">
        ← {game.data!.name}
      </Link>
      <nav className="gm-tabs" aria-label="GM screen">
        <button className={tab === "table" ? "on" : ""} aria-current={tab === "table" ? "page" : undefined} onClick={() => setTab("table")}>
          Table
        </button>
        <button className={tab === "maps" ? "on" : ""} aria-current={tab === "maps" ? "page" : undefined} onClick={() => setTab("maps")}>
          Map editor
        </button>
      </nav>
      <a href={`/games/${id}/board`} target="_blank" rel="noreferrer">
        Open board
      </a>
      {meta.data && <span className="muted">Invite code: {meta.data.inviteCode}</span>}
      {actionError && <span className="error">{actionError}</span>}
      {/* Last, so its changing text ("Hosting", "Reconnecting…") never pushes the links over. */}
      <ConnectionBadge status={snapshot.status} />
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
              <MapList table={table} editingId={editing} onPick={setPreviewId} act={act} />
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
                      Players are on <strong>{table.map.name}</strong>. You're getting <strong>{table.maps?.[editing]?.name}</strong> ready; they can't see it
                      until you move them.
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

  const sheetHref = (t: Token) =>
    (t.side === "player" ? t.ownerId && `/games/${id}/characters/${t.ownerId}` : t.templateId && `/games/${id}/npcs`) || undefined;
  const gearSource = (t: Token) =>
    t.side === "player"
      ? t.ownerId
        ? characters?.[t.ownerId]
        : undefined
      : t.templateId && templates?.[t.templateId]
        ? normalizeNpc(templates[t.templateId])
        : undefined;

  return (
    <main className="gm gm-table">
      {header}

      <section className="gm-main">
        {table && (
          <div className="gm-toolbar">
            <ToolbarMenu
              title="Maps"
              label={
                <>
                  Maps{" "}
                  <span className="muted small toolbar-map-name" title={table.map.name}>
                    · {table.map.name}
                  </span>
                </>
              }
            >
              {(close) => (
                <>
                  <p className="muted small">Pick a map to preview it before moving the players there.</p>
                  <MapList
                    table={table}
                    onPick={(mapId) => {
                      setPreviewId(mapId);
                      close();
                    }}
                  />
                  <button onClick={() => setTab("maps")}>Open the map editor</button>
                </>
              )}
            </ToolbarMenu>
            <ToolbarMenu title="Characters" label="Characters">
              {(close) => (
                <TemplateList
                  gameId={id}
                  templates={templates}
                  table={table}
                  onPlace={(templateId, template) => {
                    setPlacing({ templateId, template });
                    setLayer("tokens");
                    setSelectedId(null);
                    close();
                  }}
                />
              )}
            </ToolbarMenu>
            <ToolbarMenu
              title="Popups for players"
              label={
                <>
                  Popups
                  {popupsUp ? (
                    <span className="count-badge" aria-label={`${popupsUp} up`}>
                      {popupsUp}
                    </span>
                  ) : null}
                </>
              }
              wide
            >
              {() => (
                <GmPopups
                  gameId={id}
                  table={table}
                  players={players}
                  act={act}
                  draft={popupDraft}
                  setDraft={setPopupDraft}
                  characters={characters}
                />
              )}
            </ToolbarMenu>
            {/* Stays put during combat (greyed out), so the fog tools beside it don't jump. */}
            <ToolbarMenu
              title="Start combat"
              label={<StableLabel labels={["Start combat", "In combat"]} show={table.combat ? 1 : 0} />}
              disabled={!!table.combat}
              disabledTitle="End combat from the combat panel on the right"
            >
              {(close) => <CombatStart table={table} act={act} onStarted={close} />}
            </ToolbarMenu>
            <FogTools mode={fogMode} setMode={setFogMode} onAll={(hidden) => act({ type: "fogAll", mapId: table.map.id!, hidden })} />
            <span className="muted small gm-hint">
              {fogMode
                ? `Drag across the map to ${fogMode} an area. Esc to stop.`
                : layer === "assets"
                  ? "Drag an asset to move it. Hold Alt to flip snapping."
                  : layer === "pins"
                    ? "Drag a pin to move it, or click it to read its note."
                    : "Click a token to see it; with it open, click a tile to move it."}
            </span>
          </div>
        )}
        <div className={"gm-map-area" + (placing ? " placing" : "")} style={table ? ({ "--map-ratio": `${table.map.width / table.map.height}` } as React.CSSProperties) : undefined}>
          {table && (
            // The map and its layer switch, which sits on the map's bottom-left corner.
            <div className="gm-map-frame">
              <MapView key={(mapTable ?? table).map.id ?? ""}>
                <Grid
                  state={mapTable ?? table}
                  fx={fx}
                  speed={speed}
                  vfx={vfx}
                  selectedId={selectedId}
                  activeId={table.combat ? activeToken(table)?.id : undefined}
                  slotControls={{ isGm: true, uid: user?.id, act }}
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
                  layer={layer}
                  snap={snap}
                  onMoveItem={(itemId, to) => act({ type: "updateMapItem", mapId: table.map.id!, itemId, patch: to })}
                  onCellClick={(x, y) => {
                    if (layer !== "tokens") return;
                    if (placing) {
                      act({ type: "spawnEnemy", templateId: placing.templateId, template: npcSpawnData(placing.template, formulas), x, y });
                      setPlacing(null);
                    } else if (selectedId) act({ type: "move", tokenId: selectedId, x, y });
                  }}
                  fog="gm"
                >
                  {fogMode && <FogDraw map={table.map} mode={fogMode} onDraw={(r) => act({ type: "drawFog", mapId: table.map.id!, ...r })} />}
                </Grid>
              </MapView>
              <LayerSwitch
                layer={layer}
                onLayer={(l) => {
                  setLayer(l);
                  if (l !== "tokens") {
                    setSelectedId(null);
                    setPlacing(null);
                  }
                }}
                snap={snap}
                onSnap={setSnap}
              />
            </div>
          )}
          {table?.combat && !(speed?.whole && speed.stage === "roll") && <EnemyTurnPopup table={table} act={act} />}
          {selected && (
            <TokenPopup
              key={selected.id}
              token={selected}
              gear={tokenGear(selected, gearSource(selected))}
              gm={{ act, note: snapshot.notes[selected.id] ?? "", sheetHref: sheetHref(selected), onRemoved: () => setSelectedId(null) }}
              onClose={() => setSelectedId(null)}
            />
          )}
        </div>
        <ul className="gm-players plain" aria-label="Players">
          {players.length === 0 && <li className="muted">No players yet.</li>}
          {players.map((p) => (
            <li key={p.uid} className="gm-player">
              <span className="game-player-name">
                <span className={"dot " + (online.has(p.uid) ? "ok" : "bad")} /> {p.username}
              </span>
              {p.character ? <PlayerPreview entry={p} newTab /> : <span className="muted small">No character yet</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="gm-side">
        {table?.combat && <CombatPanel table={table} act={act} speed={speed} />}
        <div className="gm-log">
          <h3>Log</h3>
          <ol className="log">
            {table?.log
              .slice(-200)
              .reverse()
              .map((line, i) => (
                <li key={`${table.log.length}-${i}`} className={line.startsWith(" ") ? "detail" : ""}>
                  {line.trim()}
                </li>
              ))}
          </ol>
        </div>
      </section>
      {preview}
    </main>
  );
}

/** A button above the map that opens a dropdown; clicking outside closes it. */
function ToolbarMenu({
  title,
  label,
  wide,
  disabled,
  disabledTitle,
  children,
}: {
  title: string;
  label: React.ReactNode;
  wide?: boolean;
  disabled?: boolean;
  disabledTitle?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useDrag<HTMLDivElement>();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !(e.target as Element).closest?.(".overlay") && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="toolbar-menu" ref={ref}>
      <button className={open ? "on" : ""} aria-expanded={open} disabled={disabled} title={disabled ? disabledTitle : undefined} onClick={() => setOpen((o) => !o)}>
        {label} <span className="muted">▾</span>
      </button>
      {open && !disabled && (
        <div className={"toolbar-dropdown" + (wide ? " wide" : "")} role="dialog" aria-label={title} ref={drag.ref} style={drag.style}>
          <header className="popup-head" {...drag.handle}>
            <strong>{title}</strong>
            <button type="button" className="icon" aria-label="Close" onClick={() => setOpen(false)}>
              ✕
            </button>
          </header>
          <div className="popup-body">{children(() => setOpen(false))}</div>
        </div>
      )}
    </div>
  );
}

/** Pick who's in the fight, roll Speed and start combat. */
function CombatStart({ table, act, onStarted }: { table: TableState; act: (action: TableAction) => boolean; onStarted: () => void }) {
  const tokens = Object.values(table.tokens);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(tokens.map((t) => t.id)));
  return (
    <div className="combat-start">
      <h3>Who's in this fight?</h3>
      <p className="muted small">Each rolls 1d6 + Justice for Speed.</p>
      {tokens.length === 0 && <p className="muted small">Place some characters first.</p>}
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
              <span className="muted small">
                ({t.side}, Justice {t.justice ?? 0})
              </span>
            </label>
          </li>
        ))}
      </ul>
      <button className="big-button" disabled={picked.size === 0} onClick={() => act({ type: "startCombat", tokenIds: [...picked] }) && onStarted()}>
        Roll Speed and start
      </button>
    </div>
  );
}

/**
 * On a GM character's turn, their Combat Actions pop up over the map, so the side panel never has
 * to scroll. Closing it hides it for this turn; the next GM character's turn brings it back.
 */
function EnemyTurnPopup({ table, act }: { table: TableState; act: (action: TableAction) => boolean }) {
  const token = gmTurnToken(table);
  const combat = table.combat!;
  const turnKey = `${combat.round}:${combat.turn}:${token?.id}`;
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  const drag = useDrag<HTMLElement>();
  if (!token) return null;
  if (hiddenFor === turnKey) {
    return (
      <button type="button" className="turn-popup-reopen" onClick={() => setHiddenFor(null)}>
        Show {token.name}'s actions
      </button>
    );
  }
  return (
    <aside className="turn-popup" aria-label={`${token.name}'s turn`} ref={drag.ref} style={drag.style}>
      <header className="popup-head" {...drag.handle}>
        <span className="swatch" style={{ background: token.color }} />
        <strong className="turn-popup-title">{token.name}'s turn</strong>
        <button type="button" className="icon" aria-label="Close" onClick={() => setHiddenFor(turnKey)}>
          ✕
        </button>
      </header>
      <div className="popup-body">
        <ActionPanel table={table} token={token} canAct send={(a) => void act(a)} />
      </div>
    </aside>
  );
}

/** Run the turn order and end combat. */
function CombatPanel({ table, act, speed }: { table: TableState; act: (action: TableAction) => boolean; speed: SpeedStep | null }) {
  const tokens = Object.values(table.tokens);
  const combat = table.combat!;

  const outside = tokens.filter((t) => !combat.order.some((c) => c.tokenId === t.id));
  const active = activeToken(table);
  return (
    <div className="combat-panel">
      <div className="row-between">
        <h3>Combat · Round {combat.round}</h3>
        <ConfirmButton className="danger" confirmLabel="End it?" onConfirm={() => act({ type: "endCombat" })}>
          End combat
        </ConfirmButton>
      </div>
      {active && (
        <p className="muted small">
          {active.name}'s turn · {PHASE_LABELS[combat.phase]} · {combat.movementLeft} Movement left
        </p>
      )}
      {active?.side === "player" && combat.aim && (
        <p className="muted small">
          {active.name} is aiming {combat.pages[combat.aim.pageId]?.name}. Lit tokens can be clicked to target for them.
        </p>
      )}
      <TurnOrder
        table={table}
        speed={speed}
        onMove={(tokenId, to) => act({ type: "reorderCombatant", tokenId, to })}
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
        <select aria-label="Add to turn order" value="" onChange={(e) => e.target.value && act({ type: "addCombatant", tokenId: e.target.value })}>
          <option value="">+ Add to turn order…</option>
          {outside.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** The GM's characters (enemies, allies and others), ready to place on the map. */
function TemplateList({
  gameId,
  templates,
  table,
  onPlace,
}: {
  gameId: string;
  templates: Record<string, NpcTemplate> | undefined;
  table: TableState;
  /** Picked: the GM then clicks a tile to put it there. */
  onPlace: (templateId: string, t: NpcTemplate) => void;
}) {
  const list = Object.entries(templates ?? {})
    .map(([tid, raw]) => [tid, normalizeNpc(raw)] as const)
    .sort((a, b) => a[1].name.localeCompare(b[1].name));
  return (
    <div className="template-panel">
      <div className="row-between">
        <strong>Characters</strong>
        <a href={`/games/${gameId}/npcs`} target="_blank" rel="noreferrer" className="small">
          Manage ↗
        </a>
      </div>
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
            <button onClick={() => onPlace(tid, t)}>Place…</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
