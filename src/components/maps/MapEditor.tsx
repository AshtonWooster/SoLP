import { useEffect, useRef, useState } from "react";
import type { NpcTemplate } from "../../../shared/character.ts";
import { newId } from "../../../shared/engine.ts";
import { arrivalSpot, type Corner, MAP_MAX, MAP_MIN, moveRect, type Rect, resizeRect, snapValue, travels } from "../../../shared/maps.ts";
import { normalizeNpc, npcSpawnData } from "../../../shared/ruleset.ts";
import type { MapInfo, MapItem, SavedMap, TableAction, TableState, Token } from "../../../shared/types.ts";
import { useCollection } from "../../api.ts";
import { friendlyError } from "../../firebase.ts";
import { ImageUpload, uploadImage } from "../ImageUpload.tsx";
import { NumberField } from "../NumberField.tsx";
import { PIN_COLORS, Pin } from "./MapLayers.tsx";

type Act = (a: TableAction) => boolean;
type LayerKey = "pins" | "tokens" | "assets" | "background";
type Selection = { type: "item" | "token"; id: string } | null;
/** A token on the map being edited. Ghosts are player characters on a map the players aren't on: where they'll arrive. */
type EditorToken = Token & { ghost?: boolean };

const LAYERS: { key: LayerKey; label: string; hint: string }[] = [
  { key: "pins", label: "Pins & notes", hint: "Drawn over everything" },
  { key: "tokens", label: "Tokens", hint: "Players and characters" },
  { key: "assets", label: "Assets", hint: "Images over the background" },
  { key: "background", label: "Background", hint: "The map image" },
];
const BASE_CELL = 44;
const HISTORY_LIMIT = 60;

/** The GM's choice to snap to the grid, remembered on this device. */
function useSnap(): [boolean, (on: boolean) => void] {
  const [snap, setSnap] = useState(() => {
    try {
      return localStorage.getItem("solp.mapSnap") !== "off";
    } catch {
      return true;
    }
  });
  return [
    snap,
    (on) => {
      setSnap(on);
      try {
        localStorage.setItem("solp.mapSnap", on ? "on" : "off");
      } catch {
        /* private window: just not remembered */
      }
    },
  ];
}

/** The map being edited (on the table or not), and the tokens on it. */
export function editedMap(table: TableState, mapId: string): { map: MapInfo & { id: string }; tokens: EditorToken[]; current: boolean } | undefined {
  if (mapId === table.map.id) return { map: table.map as MapInfo & { id: string }, tokens: Object.values(table.tokens), current: true };
  const saved = table.maps?.[mapId];
  if (!saved) return undefined;
  const players = Object.values(table.tokens).filter(travels);
  return {
    map: saved,
    tokens: [...Object.values(saved.tokens), ...players.map((t, i) => ({ ...t, ...arrivalSpot(saved as SavedMap, t.id, i), ghost: true }))],
    current: false,
  };
}

type Drag =
  | { kind: "move" | "resize"; id: string; corner?: Corner; sx: number; sy: number; from: Rect; to: Rect; moved: boolean }
  | { kind: "pin"; id: string; sx: number; sy: number; from: { x: number; y: number }; to: { x: number; y: number }; moved: boolean }
  | { kind: "token"; id: string; sx: number; sy: number; from: { x: number; y: number }; to: { x: number; y: number }; moved: boolean };
/** A drag as it starts: the pointer position is filled in by startDrag. */
type DragStart = Drag extends infer D ? (D extends Drag ? Omit<D, "sx" | "sy" | "moved"> : never) : never;

/**
 * The map editor: three layers (background at the bottom, assets in the middle, tokens on top) with
 * pins and notes over them. Drag to move, corners to resize, snap to the grid or place freely, and
 * hide anything from players. Works on the map the players are on or one being got ready.
 */
export function MapEditor({
  gameId,
  table,
  mapId,
  act,
  onEditToken,
}: {
  gameId: string;
  table: TableState;
  mapId: string;
  act: Act;
  /** Open a token's stats on the table screen (tokens on the players' map only). */
  onEditToken?: (tokenId: string) => void;
}) {
  const scope = editedMap(table, mapId);
  const [sel, setSel] = useState<Selection>(null);
  const [tool, setTool] = useState<"select" | "pin">("select");
  const [snap, setSnap] = useSnap();
  const [zoom, setZoom] = useState(1);
  const [asPlayers, setAsPlayers] = useState(false);
  const [layers, setLayers] = useState<Record<LayerKey, { show: boolean; lock: boolean }>>({
    pins: { show: true, lock: false },
    tokens: { show: true, lock: false },
    assets: { show: true, lock: false },
    background: { show: true, lock: false },
  });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [error, setError] = useState("");
  const history = useRef<Record<string, { undo: MapItem[][]; redo: MapItem[][] }>>({});
  const [, bump] = useState(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => setSel(null), [mapId]);

  const map = scope?.map;
  const items = map?.items ?? [];
  const cell = BASE_CELL * zoom;
  const hist = (history.current[mapId] ??= { undo: [], redo: [] });
  const selectedItem = sel?.type === "item" ? items.find((i) => i.id === sel.id) : undefined;
  const selectedToken = sel?.type === "token" ? scope?.tokens.find((t) => t.id === sel.id) : undefined;

  /** Every change to assets and pins goes through here, so it can be undone. */
  const change = (action: TableAction) => {
    const before = structuredClone(items);
    if (!act(action)) return false;
    hist.undo.push(before);
    if (hist.undo.length > HISTORY_LIMIT) hist.undo.shift();
    hist.redo = [];
    bump((n) => n + 1);
    return true;
  };
  const undo = () => {
    const prev = hist.undo.pop();
    if (!prev) return;
    hist.redo.push(structuredClone(items));
    act({ type: "setMapItems", mapId, items: prev });
    bump((n) => n + 1);
  };
  const redo = () => {
    const next = hist.redo.pop();
    if (!next) return;
    hist.undo.push(structuredClone(items));
    act({ type: "setMapItems", mapId, items: next });
    bump((n) => n + 1);
  };
  const updateItem = (id: string, patch: Partial<MapItem>) => change({ type: "updateMapItem", mapId, itemId: id, patch });
  const removeItem = (id: string) => change({ type: "removeMapItem", mapId, itemId: id }) && setSel(null);
  const duplicate = (item: MapItem) => {
    const copy = { ...structuredClone(item), id: newId(), x: item.x + 1, y: item.y + 1 };
    if (change({ type: "addMapItem", mapId, item: copy })) setSel({ type: "item", id: copy.id });
  };

  /** The middle of what the GM is looking at, in tiles. */
  const viewCenter = () => {
    const w = wrapRef.current;
    if (!w || !map) return { x: 1, y: 1 };
    return {
      x: Math.max(0, Math.min(map.width - 1, (w.scrollLeft + w.clientWidth / 2) / cell)),
      y: Math.max(0, Math.min(map.height - 1, (w.scrollTop + w.clientHeight / 2) / cell)),
    };
  };

  const addImage = async (url: string, name?: string) => {
    if (!map) return;
    // Sized from the picture's own shape: its longer side a quarter of the map, at least a tile.
    const ratio = await new Promise<number>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1);
      img.onerror = () => resolve(1);
      img.src = url;
    });
    const long = Math.max(1, Math.min(6, Math.round(Math.min(map.width, map.height) / 4)));
    let w = ratio >= 1 ? long : long * ratio;
    let h = ratio >= 1 ? long / ratio : long;
    w = Math.max(snap ? 1 : 0.25, snapValue(w, snap));
    h = Math.max(snap ? 1 : 0.25, snapValue(h, snap));
    const c = viewCenter();
    const item: Partial<MapItem> = { id: newId(), kind: "image", url, x: snapValue(c.x - w / 2, snap), y: snapValue(c.y - h / 2, snap), w, h };
    if (name) item.name = name.replace(/\.[a-z0-9]+$/i, "").slice(0, 60);
    if (change({ type: "addMapItem", mapId, item })) {
      setSel({ type: "item", id: item.id! });
      setLayers((l) => ({ ...l, assets: { ...l.assets, show: true } }));
    }
  };

  // Keyboard: Delete, arrows to nudge, Ctrl+Z / Ctrl+Shift+Z, Ctrl+D, H to hide, Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable], .overlay")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === "Escape") {
        setSel(null);
        setTool("select");
        return;
      }
      if (!selectedItem) return;
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicate(selectedItem);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeItem(selectedItem.id);
      } else if (e.key.toLowerCase() === "h" && !mod) {
        updateItem(selectedItem.id, { hidden: !selectedItem.hidden });
      } else if (e.key.startsWith("Arrow") && !selectedItem.locked) {
        e.preventDefault();
        const step = snap || e.shiftKey ? 1 : 0.1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        updateItem(selectedItem.id, { x: snapValue(selectedItem.x + dx, false), y: snapValue(selectedItem.y + dy, false) });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Dragging: follow the pointer, then save once on release.
  useEffect(() => {
    if (!drag || !map) return;
    const onMove = (e: PointerEvent) => {
      const dx = (e.clientX - drag.sx) / cell;
      const dy = (e.clientY - drag.sy) / cell;
      // Alt flips snapping for this drag.
      const snapNow = e.altKey ? !snap : snap;
      const moved = drag.moved || Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3;
      if (drag.kind === "move") setDrag({ ...drag, moved, to: moveRect(drag.from, dx, dy, snapNow) });
      else if (drag.kind === "resize") setDrag({ ...drag, moved, to: resizeRect(drag.from, drag.corner!, dx, dy, { snap: snapNow, keepAspect: e.shiftKey }) });
      else if (drag.kind === "pin") {
        const at = (v: number) => (snapNow ? Math.floor(v) + 0.5 : snapValue(v, false));
        setDrag({ ...drag, moved, to: { x: at(drag.from.x + dx), y: at(drag.from.y + dy) } });
      } else if (drag.kind === "token") {
        const tile = (v: number, max: number) => Math.max(0, Math.min(max - 1, Math.round(v)));
        setDrag({ ...drag, moved, to: { x: tile(drag.from.x + dx, map.width), y: tile(drag.from.y + dy, map.height) } });
      }
    };
    const onUp = () => {
      const d = drag;
      setDrag(null);
      if (!d.moved) return;
      if (d.kind === "token") act({ type: "placeToken", mapId, tokenId: d.id, x: d.to.x, y: d.to.y });
      else updateItem(d.id, d.to);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  });

  if (!scope || !map) return <p className="muted">That map is gone. Pick another one.</p>;

  const startDrag = (e: React.PointerEvent, d: DragStart) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setDrag({ ...d, sx: e.clientX, sy: e.clientY, moved: false } as Drag);
  };

  /** Where an item is drawn right now (following a drag in progress). */
  const live = (i: MapItem) => (drag && drag.id === i.id && drag.kind !== "token" ? { ...i, ...drag.to } : i);
  const shown = (hidden?: boolean) => !(asPlayers && hidden);
  const images = items.filter((i) => i.kind === "image" && shown(i.hidden)).map(live);
  const pins = items.filter((i) => i.kind === "pin" && shown(i.hidden)).map(live);
  const tokens = scope.tokens.filter((t) => shown(t.hidden));
  const px = (n: number) => `${n * cell}px`;
  // Images already on any of the game's maps, to reuse with a click.
  const allMaps = [table.map, ...Object.values(table.maps ?? {})];
  const reused = [...new Set(allMaps.flatMap((m) => (m.items ?? []).filter((i) => i.kind === "image").map((i) => i.url!)))].slice(0, 24);
  const hiddenCount = items.filter((i) => i.hidden).length + scope.tokens.filter((t) => t.hidden).length + (map.background && map.backgroundHidden ? 1 : 0);

  return (
    <div className="map-editor-screen">
      <div className="me-toolbar" role="toolbar" aria-label="Map editor tools">
        <div className="seg">
          <button className={tool === "select" ? "on" : ""} onClick={() => setTool("select")} title="Select, drag and resize (Esc)">
            ↖ Select
          </button>
          <button className={tool === "pin" ? "on" : ""} onClick={() => setTool("pin")} title="Click the map to drop a pin with a note">
            📍 Pin
          </button>
        </div>
        <UploadButton gameId={gameId} onUploaded={addImage} onError={setError} />
        <label className="me-check">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Snap to grid
        </label>
        <label className="me-check" title="Leave out everything hidden, the way players see this map">
          <input type="checkbox" checked={asPlayers} onChange={(e) => setAsPlayers(e.target.checked)} /> View as players
        </label>
        <span className="seg">
          <button onClick={undo} disabled={!hist.undo.length} title="Undo (Ctrl+Z)" aria-label="Undo">
            ↶
          </button>
          <button onClick={redo} disabled={!hist.redo.length} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
            ↷
          </button>
        </span>
        <span className="seg">
          <button onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.2).toFixed(1)))} aria-label="Zoom out">
            −
          </button>
          <span className="zoom-label">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(2.4, +(z + 0.2).toFixed(1)))} aria-label="Zoom in">
            +
          </button>
        </span>
        {error && <span className="error small">{error}</span>}
      </div>

      <div className="me-body">
        <div
          className="me-canvas-wrap"
          ref={wrapRef}
          onWheel={(e) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            setZoom((z) => Math.max(0.4, Math.min(2.4, +(z - Math.sign(e.deltaY) * 0.1).toFixed(1))));
          }}
        >
          <div
            ref={canvasRef}
            className={"me-canvas" + (tool === "pin" ? " placing" : "") + (drag ? " dragging" : "")}
            style={{ width: px(map.width), height: px(map.height) }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              if (tool !== "pin") return setSel(null);
              const r = canvasRef.current!.getBoundingClientRect();
              const x = (e.clientX - r.left) / cell;
              const y = (e.clientY - r.top) / cell;
              const pin: Partial<MapItem> = { id: newId(), kind: "pin", x: snap ? Math.floor(x) + 0.5 : snapValue(x, false), y: snap ? Math.floor(y) + 0.5 : snapValue(y, false), name: "Note" };
              if (change({ type: "addMapItem", mapId, item: pin })) {
                setSel({ type: "item", id: pin.id! });
                setTool("select");
                setLayers((l) => ({ ...l, pins: { ...l.pins, show: true } }));
              }
            }}
          >
            {layers.background.show && map.background && shown(map.backgroundHidden) && (
              <img className={"me-bg" + (map.backgroundHidden ? " is-hidden" : "")} src={map.background} alt="" draggable={false} />
            )}
            {layers.assets.show && (
              <div className={"me-layer" + (layers.assets.lock ? " locked" : "")}>
                {images.map((i) => (
                  <div
                    key={i.id}
                    className={"me-asset" + (i.hidden ? " is-hidden" : "") + (i.locked ? " is-locked" : "") + (selectedItem?.id === i.id ? " selected" : "")}
                    style={{ left: px(i.x), top: px(i.y), width: px(i.w!), height: px(i.h!) }}
                    onPointerDown={(e) => {
                      if (tool === "pin") return;
                      setSel({ type: "item", id: i.id });
                      if (i.locked) return e.stopPropagation();
                      startDrag(e, { kind: "move", id: i.id, from: { x: i.x, y: i.y, w: i.w!, h: i.h! }, to: { x: i.x, y: i.y, w: i.w!, h: i.h! } });
                    }}
                    title={i.name ?? "Asset"}
                  >
                    <img src={i.url} alt={i.name ?? ""} draggable={false} style={{ rotate: i.rotation ? `${i.rotation}deg` : undefined }} />
                    {i.hidden && <span className="hidden-tag">Hidden</span>}
                    {selectedItem?.id === i.id &&
                      !i.locked &&
                      (["nw", "ne", "sw", "se"] as Corner[]).map((c) => (
                        <span
                          key={c}
                          className={`me-handle ${c}`}
                          onPointerDown={(e) => startDrag(e, { kind: "resize", id: i.id, corner: c, from: { x: i.x, y: i.y, w: i.w!, h: i.h! }, to: { x: i.x, y: i.y, w: i.w!, h: i.h! } })}
                        />
                      ))}
                  </div>
                ))}
              </div>
            )}
            {!map.hideGrid && <div className="me-gridlines" style={{ backgroundSize: `${cell}px ${cell}px` }} />}
            {layers.tokens.show && (
              <div className={"me-layer" + (layers.tokens.lock ? " locked" : "")}>
                {tokens.map((t) => {
                  const at = drag?.kind === "token" && drag.id === t.id ? drag.to : t;
                  return (
                    <button
                      key={t.id}
                      className={`me-token ${t.side}` + (t.hidden ? " is-hidden" : "") + (t.ghost ? " ghost" : "") + (selectedToken?.id === t.id ? " selected" : "")}
                      style={{
                        left: px(at.x + 0.08),
                        top: px(at.y + 0.08),
                        width: px(0.84),
                        height: px(0.84),
                        background: t.portrait ? `center / cover no-repeat url("${t.portrait}"), ${t.color}` : t.color,
                      }}
                      title={t.ghost ? `${t.name} arrives here` : t.hidden ? `${t.name} (hidden from players)` : t.name}
                      onPointerDown={(e) => {
                        if (tool === "pin") return;
                        setSel({ type: "token", id: t.id });
                        startDrag(e, { kind: "token", id: t.id, from: { x: t.x, y: t.y }, to: { x: t.x, y: t.y } });
                      }}
                    >
                      <span className="token-name">{t.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {layers.pins.show && (
              <div className={"me-layer" + (layers.pins.lock ? " locked" : "")} style={{ ["--cell" as string]: `${cell}px` }}>
                {pins.map((p) => (
                  <div
                    key={p.id}
                    className="me-pin-wrap"
                    style={{ left: px(p.x), top: px(p.y) }}
                    onPointerDown={(e) => {
                      if (tool === "pin") return;
                      setSel({ type: "item", id: p.id });
                      if (p.locked) return e.stopPropagation();
                      startDrag(e, { kind: "pin", id: p.id, from: { x: p.x, y: p.y }, to: { x: p.x, y: p.y } });
                    }}
                  >
                    <Pin map={{ ...map, width: 1, height: 1 }} pin={{ ...p, x: 0, y: 0 }} selected={selectedItem?.id === p.id} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="me-side">
          <section className="me-section">
            <h4>Layers</h4>
            <ul className="plain me-layers">
              {LAYERS.map((l) => (
                <li key={l.key}>
                  <span>
                    <strong>{l.label}</strong> <span className="muted small">{l.hint}</span>
                  </span>
                  <button
                    className={"icon" + (layers[l.key].show ? "" : " off")}
                    aria-label={`${layers[l.key].show ? "Hide" : "Show"} the ${l.label} layer while editing`}
                    title="Show or hide while you edit (players aren't affected)"
                    onClick={() => setLayers({ ...layers, [l.key]: { ...layers[l.key], show: !layers[l.key].show } })}
                  >
                    {layers[l.key].show ? "👁" : "◌"}
                  </button>
                  {l.key !== "background" && (
                    <button
                      className={"icon" + (layers[l.key].lock ? " on" : "")}
                      aria-label={`${layers[l.key].lock ? "Unlock" : "Lock"} the ${l.label} layer`}
                      title="Lock: clicks go through to the layers below"
                      onClick={() => setLayers({ ...layers, [l.key]: { ...layers[l.key], lock: !layers[l.key].lock } })}
                    >
                      {layers[l.key].lock ? "🔒" : "🔓"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {hiddenCount > 0 && <p className="muted small">{hiddenCount} hidden from players. They show faded here.</p>}
          </section>

          {selectedItem?.kind === "image" && (
            <AssetInspector
              key={selectedItem.id}
              item={selectedItem}
              onChange={(patch) => updateItem(selectedItem.id, patch)}
              onArrange={(to) => change({ type: "arrangeMapItem", mapId, itemId: selectedItem.id, to })}
              onDuplicate={() => duplicate(selectedItem)}
              onRemove={() => removeItem(selectedItem.id)}
            />
          )}
          {selectedItem?.kind === "pin" && (
            <PinInspector key={selectedItem.id} pin={selectedItem} onChange={(patch) => updateItem(selectedItem.id, patch)} onRemove={() => removeItem(selectedItem.id)} />
          )}
          {selectedToken && (
            <TokenInspector
              token={selectedToken}
              onHide={(hidden) => act({ type: "setTokenHidden", mapId, tokenId: selectedToken.id, hidden })}
              onRemove={() => act({ type: "removeToken", tokenId: selectedToken.id, mapId }) && setSel(null)}
              onEdit={scope.current && onEditToken ? () => onEditToken(selectedToken.id) : undefined}
            />
          )}

          <MapSettings gameId={gameId} map={map} act={act} />
          <PlaceCharacters gameId={gameId} map={map} act={act} />

          {reused.length > 0 && (
            <section className="me-section">
              <h4>Images in this game</h4>
              <div className="me-reuse">
                {reused.map((url) => (
                  <button key={url} onClick={() => addImage(url)} title="Add to this map" aria-label="Add this image to the map">
                    <img src={url} alt="" />
                  </button>
                ))}
              </div>
            </section>
          )}
          <p className="muted small me-help">
            Drag to move; drag a corner to resize (Shift keeps the shape, Alt flips snapping). Arrows nudge, Delete removes, Ctrl+D duplicates, H hides. Ctrl+scroll zooms.
          </p>
        </aside>
      </div>
    </div>
  );
}

function UploadButton({ gameId, onUploaded, onError }: { gameId: string; onUploaded: (url: string, name: string) => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <label className={"button-like" + (busy ? " disabled" : "")} title="Add an image to the asset layer">
      {busy ? "Uploading…" : "🖼 Add image"}
      <input
        type="file"
        accept="image/*"
        hidden
        disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          onError("");
          try {
            onUploaded(await uploadImage(`games/${gameId}/assets/maps`, file), file.name);
          } catch (err) {
            onError(friendlyError(err));
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
}

function HiddenSwitch({ hidden, onChange, disabled, title }: { hidden: boolean; onChange: (hidden: boolean) => void; disabled?: boolean; title?: string }) {
  return (
    <label className="toggle-row compact" title={title}>
      <span>
        <strong>Hidden from players</strong>
        <span className="muted small">Only you see it</span>
      </span>
      <input type="checkbox" role="switch" className="switch" aria-label="Hidden from players" checked={hidden} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function AssetInspector({
  item,
  onChange,
  onArrange,
  onDuplicate,
  onRemove,
}: {
  item: MapItem;
  onChange: (patch: Partial<MapItem>) => void;
  onArrange: (to: "front" | "back" | "forward" | "backward") => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(item.name ?? "");
  return (
    <section className="me-section">
      <h4>Asset</h4>
      <input aria-label="Asset name" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== (item.name ?? "") && onChange({ name })} />
      <div className="me-grid4">
        {(["x", "y", "w", "h"] as const).map((k) => (
          <label key={k} className="inline">
            {k.toUpperCase()} <NumberField label={`Asset ${k}`} step={0.25} value={item[k] ?? 0} onCommit={(n) => onChange({ [k]: n })} />
          </label>
        ))}
      </div>
      <label className="inline">
        Rotate <NumberField label="Rotation in degrees" step={15} value={item.rotation ?? 0} onCommit={(n) => onChange({ rotation: n })} />°
      </label>
      <HiddenSwitch hidden={!!item.hidden} onChange={(hidden) => onChange({ hidden })} />
      <label className="me-check">
        <input type="checkbox" checked={!!item.locked} onChange={(e) => onChange({ locked: e.target.checked })} /> Locked in place
      </label>
      <div className="row wrap">
        <button onClick={() => onArrange("front")} title="Bring to front">To front</button>
        <button onClick={() => onArrange("forward")} title="Bring forward">Forward</button>
        <button onClick={() => onArrange("backward")} title="Send backward">Backward</button>
        <button onClick={() => onArrange("back")} title="Send to back">To back</button>
      </div>
      <div className="row">
        <button onClick={onDuplicate}>Duplicate</button>
        <button className="danger" onClick={onRemove}>
          Delete
        </button>
      </div>
    </section>
  );
}

function PinInspector({ pin, onChange, onRemove }: { pin: MapItem; onChange: (patch: Partial<MapItem>) => void; onRemove: () => void }) {
  const [name, setName] = useState(pin.name ?? "");
  const [note, setNote] = useState(pin.note ?? "");
  return (
    <section className="me-section">
      <h4>Pin</h4>
      <input aria-label="Pin label" placeholder="Label" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== (pin.name ?? "") && onChange({ name })} />
      <textarea aria-label="Pin note" placeholder="Note (players can read it by tapping the pin, unless it's hidden)" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (pin.note ?? "") && onChange({ note })} />
      <div className="row pin-colors" role="radiogroup" aria-label="Pin color">
        {PIN_COLORS.map((c) => (
          <button
            key={c}
            role="radio"
            aria-checked={(pin.color ?? PIN_COLORS[0]) === c}
            aria-label={c}
            className={"swatch-button" + ((pin.color ?? PIN_COLORS[0]) === c ? " on" : "")}
            style={{ background: c }}
            onClick={() => onChange({ color: c })}
          />
        ))}
      </div>
      <HiddenSwitch hidden={!!pin.hidden} onChange={(hidden) => onChange({ hidden })} />
      <label className="me-check">
        <input type="checkbox" checked={!!pin.locked} onChange={(e) => onChange({ locked: e.target.checked })} /> Locked in place
      </label>
      <button className="danger" onClick={onRemove}>
        Delete pin
      </button>
    </section>
  );
}

function TokenInspector({ token, onHide, onRemove, onEdit }: { token: EditorToken; onHide: (h: boolean) => void; onRemove: () => void; onEdit?: () => void }) {
  if (token.ghost) {
    return (
      <section className="me-section">
        <h4>{token.name}</h4>
        <p className="muted small">The players aren't on this map yet. Drag {token.name} to where they'll arrive when you move the players here.</p>
      </section>
    );
  }
  const player = !!token.ownerId;
  return (
    <section className="me-section">
      <h4>
        <span className="swatch" style={{ background: token.color }} /> {token.name} <span className="muted small">({token.side})</span>
      </h4>
      <HiddenSwitch
        hidden={!!token.hidden}
        onChange={onHide}
        disabled={player}
        title={player ? "Players' characters are always shown to them" : "Hidden tokens appear when they join combat"}
      />
      {!player && <p className="muted small">A hidden token is revealed when it joins combat.</p>}
      <div className="row">
        {onEdit && <button onClick={onEdit}>Stats and notes</button>}
        {!player && (
          <button className="danger" onClick={onRemove}>
            Remove token
          </button>
        )}
      </div>
    </section>
  );
}

/** Name, size in tiles, background, and grid lines. */
function MapSettings({ gameId, map, act }: { gameId: string; map: MapInfo & { id: string }; act: Act }) {
  const [name, setName] = useState(map.name);
  useEffect(() => setName(map.name), [map.name]);
  const commitName = () => (name.trim() && name !== map.name ? act({ type: "updateMap", mapId: map.id, name }) : setName(map.name));
  return (
    <section className="me-section">
      <h4>Map</h4>
      <input aria-label="Map name" value={name} onChange={(e) => setName(e.target.value)} onBlur={commitName} onKeyDown={(e) => e.key === "Enter" && commitName()} />
      <div className="row map-size">
        <label className="inline">
          Width <NumberField label="Width in tiles" value={map.width} onCommit={(n) => act({ type: "updateMap", mapId: map.id, width: n })} />
        </label>
        <label className="inline">
          Height <NumberField label="Height in tiles" value={map.height} onCommit={(n) => act({ type: "updateMap", mapId: map.id, height: n })} />
        </label>
        <span className="muted small">
          tiles ({MAP_MIN}–{MAP_MAX})
        </span>
      </div>
      <ImageUpload folder={`games/${gameId}/assets/maps`} label="Background" value={map.background} onChange={(url) => act({ type: "updateMap", mapId: map.id, background: url ?? null })} />
      {map.background && <HiddenSwitch hidden={!!map.backgroundHidden} onChange={(backgroundHidden) => act({ type: "updateMap", mapId: map.id, backgroundHidden })} />}
      <label className="me-check">
        <input type="checkbox" checked={!map.hideGrid} onChange={(e) => act({ type: "updateMap", mapId: map.id, hideGrid: !e.target.checked })} /> Show grid lines
      </label>
    </section>
  );
}

/** Put the GM's characters on this map, shown or hidden. */
function PlaceCharacters({ gameId, map, act }: { gameId: string; map: MapInfo & { id: string }; act: Act }) {
  const templates = useCollection<NpcTemplate>(`games/${gameId}/enemies`);
  const [hidden, setHidden] = useState(false);
  const [name, setName] = useState("");
  const list = Object.entries(templates ?? {})
    .map(([tid, raw]) => [tid, normalizeNpc(raw)] as const)
    .sort((a, b) => a[1].name.localeCompare(b[1].name));
  const y = Math.floor(map.height / 2);
  return (
    <section className="me-section">
      <h4>Add tokens</h4>
      <label className="me-check">
        <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> Place hidden
      </label>
      {templates && list.length === 0 && <p className="muted small">No characters yet. Make some in the Character editor.</p>}
      <ul className="plain me-place">
        {list.map(([tid, t]) => (
          <li key={tid}>
            <span>
              <span className="swatch" style={{ background: t.color }} /> {t.name || "Unnamed"}
            </span>
            <button
              onClick={() =>
                act({ type: "spawnEnemy", templateId: tid, template: npcSpawnData(t), x: t.side === "enemy" ? map.width - 3 : 2, y, mapId: map.id, hidden })
              }
            >
              Place
            </button>
          </li>
        ))}
      </ul>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (act({ type: "addToken", name: name || "Enemy", side: "enemy", x: map.width - 3, y, mapId: map.id, hidden })) setName("");
        }}
      >
        <input aria-label="New token name" placeholder="Quick enemy name" value={name} onChange={(e) => setName(e.target.value)} />
        <button>Add</button>
      </form>
    </section>
  );
}
