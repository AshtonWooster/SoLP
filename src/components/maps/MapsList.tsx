import { useState } from "react";
import { newId } from "../../../shared/engine.ts";
import { MAP_MAX, MAP_MIN } from "../../../shared/maps.ts";
import type { TableAction, TableState } from "../../../shared/types.ts";
import { MapPicture } from "./MapLayers.tsx";
import { editedMap } from "./MapEditor.tsx";

type Act = (a: TableAction) => boolean;

/** Every map in the game, the players' one first. */
export function allMaps(table: TableState) {
  const others = Object.values(table.maps ?? {}).sort((a, b) => a.name.localeCompare(b.name));
  return [{ ...table.map, id: table.map.id ?? "" }, ...others];
}

/** The game's maps as small pictures. Picking one opens its preview. */
export function MapList({ table, editingId, onPick }: { table: TableState; editingId?: string; onPick: (mapId: string) => void }) {
  return (
    <ul className="plain map-thumbs">
      {allMaps(table).map((m) => {
        const scope = editedMap(table, m.id);
        const waiting = scope && !scope.current ? scope.tokens.filter((t) => !t.ghost).length : 0;
        return (
          <li key={m.id}>
            <button className={"map-thumb" + (m.id === editingId ? " editing" : "")} onClick={() => onPick(m.id)} aria-label={`Preview ${m.name}`}>
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
      })}
    </ul>
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
  const scope = editedMap(table, mapId);
  if (!scope) return null;
  const { map, current } = scope;
  const tokens = scope.tokens;
  const hidden = (map.items ?? []).filter((i) => i.hidden).length + tokens.filter((t) => t.hidden).length + (map.background && map.backgroundHidden ? 1 : 0);
  const waiting = tokens.filter((t) => !t.ghost && t.side !== "player").length;
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={`Preview of ${map.name}`} onClick={onClose}>
      <div className="overlay-box map-preview" onClick={(e) => e.stopPropagation()}>
        <div className="overlay-head">
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
                <button className="danger" onClick={() => confirm(`Delete ${map.name} and the tokens waiting on it?`) && act({ type: "deleteMap", mapId }) && onClose()}>
                  Delete
                </button>
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
