import { useRef, useState } from "react";
import { newId } from "../../../shared/engine.ts";
import { groupMaps } from "../../../shared/mapFolders.ts";
import { MAP_MAX, MAP_MIN } from "../../../shared/maps.ts";
import type { TableAction, TableState } from "../../../shared/types.ts";
import { MapPicture } from "./MapLayers.tsx";
import { editedMap } from "./MapEditor.tsx";
import { ConfirmButton } from "../ConfirmButton.tsx";
import { useDrag } from "../drag.ts";
import { useBackdropClose } from "../player/Overlay.tsx";

type Act = (a: TableAction) => boolean;

/** Every map in the game, the players' one first. */
export function allMaps(table: TableState) {
  const others = Object.values(table.maps ?? {}).sort((a, b) => a.name.localeCompare(b.name));
  return [{ ...table.map, id: table.map.id ?? "" }, ...others];
}

/** The drag type for a map dragged into a folder. */
const MAP_DRAG_TYPE = "application/x-solp-map";

/**
 * The game's maps as small pictures, sorted into the GM's folders. Picking one opens its preview.
 * With `act`, the list can be organized: new folders, renaming, deleting, and dragging maps in and out.
 */
export function MapList({ table, editingId, onPick, act }: { table: TableState; editingId?: string; onPick: (mapId: string) => void; act?: Act }) {
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  // Where a dragged map would land: a folder's id, or "" for the top level.
  const [over, setOver] = useState<string | null>(null);
  const { folders, loose } = groupMaps(allMaps(table), table.mapFolders);
  const toggle = (id: string) => setClosed((c) => (c.has(id) ? new Set([...c].filter((x) => x !== id)) : new Set([...c, id])));

  // Drop targets: a folder, or the top level.
  const dropZone = (folderId: string) =>
    act && {
      onDragOver: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes(MAP_DRAG_TYPE)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        setOver(folderId);
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === folderId ? null : o));
      },
      onDrop: (e: React.DragEvent) => {
        const mapId = e.dataTransfer.getData(MAP_DRAG_TYPE);
        e.preventDefault();
        e.stopPropagation();
        setOver(null);
        if (e.dataTransfer.types.includes(MAP_DRAG_TYPE)) act({ type: "setMapFolder", mapId, folderId: folderId || null });
        if (folderId && closed.has(folderId)) toggle(folderId);
      },
    };

  const thumb = (m: ReturnType<typeof allMaps>[number]) => {
    const scope = editedMap(table, m.id);
    const waiting = scope && !scope.current ? scope.tokens.filter((t) => !t.ghost).length : 0;
    return (
      <li
        key={m.id}
        draggable={!!act}
        onDragStart={(e) => {
          e.dataTransfer.setData(MAP_DRAG_TYPE, m.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => setOver(null)}
      >
        <button
          className={"map-thumb" + (m.id === editingId ? " editing" : "")}
          onClick={() => onPick(m.id)}
          aria-label={`Preview ${m.name}`}
          title={act ? "Click to preview, or drag into a folder" : undefined}
        >
          <MapPicture map={m} tokens={scope?.tokens.filter((t) => !t.ghost) ?? []} className="thumb" />
          <span className="map-thumb-text">
            <strong>{m.name}</strong>
            <span className="muted small">
              {m.width}×{m.height}
              {waiting ? ` · ${waiting} token${waiting === 1 ? "" : "s"} waiting` : ""}
            </span>
            <span className="row">
              {m.id === table.map.id && <span className="badge-soft players-here">Players here</span>}
              {m.id === editingId && <span className="badge-soft">Editing</span>}
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className={"map-list" + (over === "" ? " drop-here" : "")} {...dropZone("")}>
      {act && (
        <button
          className="map-folder-new"
          onClick={() => {
            const id = newId();
            if (act({ type: "createMapFolder", id, name: "New folder" })) setRenaming(id);
          }}
        >
          + New folder
        </button>
      )}
      {folders.length > 0 && (
        <ul className="plain map-folders">
          {folders.map((f) => {
            const open = !closed.has(f.id);
            return (
              <li key={f.id} className={"map-folder" + (over === f.id ? " drop-here" : "")} {...dropZone(f.id)}>
                <div className="map-folder-head">
                  {renaming === f.id && act ? (
                    <FolderName
                      name={f.name}
                      onDone={(name) => {
                        if (name !== f.name) act({ type: "renameMapFolder", folderId: f.id, name });
                        setRenaming(null);
                      }}
                    />
                  ) : (
                    <button className="map-folder-toggle" aria-expanded={open} onClick={() => toggle(f.id)}>
                      <span aria-hidden>{open ? "▾" : "▸"}</span> <span className="map-folder-name">{f.name}</span>{" "}
                      <span className="muted small">{f.maps.length}</span>
                    </button>
                  )}
                  {act && renaming !== f.id && (
                    <>
                      <button className="icon" aria-label={`Rename ${f.name}`} title="Rename" onClick={() => setRenaming(f.id)}>
                        ✎
                      </button>
                      <ConfirmButton
                        className="icon danger"
                        aria-label={`Delete ${f.name}`}
                        title="Delete the folder (its maps stay)"
                        confirmLabel="Delete?"
                        ms={3000}
                        onConfirm={() => act({ type: "deleteMapFolder", folderId: f.id })}
                      >
                        🗑
                      </ConfirmButton>
                    </>
                  )}
                </div>
                {open &&
                  (f.maps.length ? (
                    <ul className="plain map-thumbs">{f.maps.map(thumb)}</ul>
                  ) : (
                    <p className="muted small map-folder-empty">{act ? "Empty. Drag maps here." : "Empty."}</p>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
      <ul className="plain map-thumbs">{loose.map(thumb)}</ul>
      {act && folders.length > 0 && <p className="muted small me-help">Drag a map onto a folder to file it, or here to take it out.</p>}
    </div>
  );
}

/** Typing a folder's new name: Enter or clicking away saves, Escape keeps the old one. */
function FolderName({ name, onDone }: { name: string; onDone: (name: string) => void }) {
  const [draft, setDraft] = useState(name);
  // Escape finishes before the blur that follows, so the blur mustn't save the draft after it.
  const done = useRef(false);
  const finish = (next: string) => {
    if (done.current) return;
    done.current = true;
    onDone(next);
  };
  return (
    <input
      className="map-folder-rename"
      aria-label="Folder name"
      autoFocus
      maxLength={60}
      value={draft}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(draft.trim() || name)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") finish(name);
      }}
    />
  );
}

/**
 * A map's preview, before the GM moves the players there or opens it to edit. The players stay on
 * their map until the GM moves them.
 */
export function MapPreview({
  table,
  mapId,
  act,
  onClose,
  onEdit,
}: {
  table: TableState;
  mapId: string;
  act: Act;
  onClose: () => void;
  /** Open this map in the map editor. */
  onEdit: () => void;
}) {
  const [asPlayers, setAsPlayers] = useState(false);
  const drag = useDrag<HTMLDivElement>();
  const backdrop = useBackdropClose(onClose);
  const scope = editedMap(table, mapId);
  if (!scope) return null;
  const { map, current } = scope;
  const tokens = scope.tokens;
  const hidden = (map.items ?? []).filter((i) => i.hidden).length + tokens.filter((t) => t.hidden).length + (map.background && map.backgroundHidden ? 1 : 0);
  const waiting = tokens.filter((t) => !t.ghost && t.side !== "player").length;
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={`Preview of ${map.name}`} {...backdrop}>
      <div className="overlay-box map-preview" ref={drag.ref} style={drag.style}>
        <div className="overlay-head" {...drag.handle}>
          <h2>
            {map.name} {current && <span className="badge-soft players-here">Players here</span>}
          </h2>
          <button className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="overlay-body">
          <div className="preview-frame" style={{ maxWidth: `calc(60vh * ${map.width} / ${map.height})` }}>
            <MapPicture map={map} tokens={tokens} asPlayers={asPlayers} />
          </div>
          <label className="me-check">
            <input type="checkbox" checked={asPlayers} onChange={(e) => setAsPlayers(e.target.checked)} /> Show it the way players will see it
          </label>
          {table.mapFolders && (
            // Filing without dragging, for touch screens.
            <label className="inline map-preview-folder">
              Folder{" "}
              <select value={map.folder && table.mapFolders[map.folder] ? map.folder : ""} onChange={(e) => act({ type: "setMapFolder", mapId, folderId: e.target.value || null })}>
                <option value="">None</option>
                {groupMaps([], table.mapFolders).folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="muted small">
            {map.width}×{map.height} tiles · {waiting} other token{waiting === 1 ? "" : "s"}
            {hidden ? ` · ${hidden} hidden from players` : ""}
            {!current && ". The party arrives where their faded tokens stand."}
          </p>
          <div className="row wrap">
            {!current && (
              <button
                className="big-button"
                disabled={!!table.combat}
                title={table.combat ? "End combat before changing maps" : undefined}
                onClick={() => act({ type: "switchMap", mapId }) && onClose()}
              >
                Move players here
              </button>
            )}
            <button className={current ? "big-button" : ""} onClick={onEdit}>
              Open in map editor
            </button>
            {!current && (
              <>
                <button onClick={() => act({ type: "createMap", id: newId(), name: "", width: map.width, height: map.height, copyFrom: mapId }) && onClose()}>Duplicate</button>
                <ConfirmButton className="danger" confirmLabel={`Delete ${map.name} and its waiting tokens?`} ms={3000} onConfirm={() => act({ type: "deleteMap", mapId }) && onClose()}>
                  Delete
                </ConfirmButton>
              </>
            )}
          </div>
          {table.combat && !current && <p className="muted small">End combat before moving the players to another map.</p>}
        </div>
      </div>
    </div>
  );
}

/** Make a new, empty map. */
export function NewMapForm({ act, onCreated }: { act: Act; onCreated?: (mapId: string) => void }) {
  const [draft, setDraft] = useState({ name: "", width: 16, height: 10 });
  return (
    <form
      className="new-map"
      onSubmit={(e) => {
        e.preventDefault();
        const id = newId();
        if (act({ type: "createMap", id, name: draft.name || "New map", width: draft.width, height: draft.height })) {
          setDraft({ name: "", width: 16, height: 10 });
          onCreated?.(id);
        }
      }}
    >
      <h4>New map</h4>
      <input aria-label="New map name" placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      <label className="inline">
        W <input aria-label="New map width" type="number" min={MAP_MIN} max={MAP_MAX} value={draft.width} onChange={(e) => setDraft({ ...draft, width: Number(e.target.value) })} />
      </label>
      <label className="inline">
        H <input aria-label="New map height" type="number" min={MAP_MIN} max={MAP_MAX} value={draft.height} onChange={(e) => setDraft({ ...draft, height: Number(e.target.value) })} />
      </label>
      <button type="submit">+ Create map</button>
    </form>
  );
}
