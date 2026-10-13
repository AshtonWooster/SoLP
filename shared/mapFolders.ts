// Folders for the GM's maps, so a long list can be sorted into places (one level, no nesting).
// A map remembers its folder in `folder`; a map with no folder, or one whose folder is gone, sits
// at the top level. Folders are the GM's own: players never get them (shared/secrets.ts), and
// nothing about them goes in the log.
import { ActionError } from "./core.ts";
import { newId } from "./id.ts";
import type { MapInfo, TableState } from "./types.ts";

/** Most folders one game can have. */
export const MAX_FOLDERS = 100;

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

function cleanName(name: unknown, fallback: string) {
  return String(name ?? "").trim().slice(0, 60) || fallback;
}

function getFolder(table: TableState, folderIdArg: unknown) {
  const id = String(folderIdArg ?? "");
  const folder = table.mapFolders?.[id];
  if (!folder) throw new ActionError("Folder not found.");
  return { id, folder };
}

/** Every map wherever it is: the one on the table, then the ones waiting. */
function everyMap(table: TableState): MapInfo[] {
  return [table.map, ...Object.values(table.maps ?? {})];
}

export function createMapFolder(table: TableState, a: { id?: unknown; name?: unknown }) {
  const folders = (table.mapFolders ??= {});
  if (Object.keys(folders).length >= MAX_FOLDERS) throw new ActionError(`A game can have up to ${MAX_FOLDERS} folders.`);
  // The list names the new folder itself, so it can open it for renaming straight away.
  const id = typeof a.id === "string" && ID_RE.test(a.id) && !folders[a.id] ? a.id : newId();
  folders[id] = { name: cleanName(a.name, "New folder") };
  return id;
}

export function renameMapFolder(table: TableState, a: { folderId?: unknown; name?: unknown }) {
  const { folder } = getFolder(table, a.folderId);
  folder.name = cleanName(a.name, folder.name);
}

/** Delete a folder. Its maps go back to the top level; no map is ever deleted with it. */
export function deleteMapFolder(table: TableState, folderIdArg: unknown) {
  const { id } = getFolder(table, folderIdArg);
  for (const m of everyMap(table)) if (m.folder === id) delete m.folder;
  delete table.mapFolders![id];
  if (!Object.keys(table.mapFolders!).length) delete table.mapFolders;
}

/** Put a map in a folder, or (folderId null) back at the top level. */
export function setMapFolder(table: TableState, a: { mapId?: unknown; folderId?: unknown }) {
  const mapId = String(a.mapId ?? "");
  const map = everyMap(table).find((m) => (m.id ?? "") === mapId);
  if (!map) throw new ActionError("Map not found.");
  if (a.folderId === null || a.folderId === undefined || a.folderId === "") {
    if (!map.folder) return false;
    delete map.folder;
    return true;
  }
  const { id } = getFolder(table, a.folderId);
  if (map.folder === id) return false;
  map.folder = id;
  return true;
}

export interface FolderGroup<M> {
  id: string;
  name: string;
  maps: M[];
}

/**
 * The maps sorted into folders (by name) and the ones at the top level, each keeping the order
 * they came in. Empty folders are listed too, so the GM can drag maps into them.
 */
export function groupMaps<M extends Pick<MapInfo, "folder">>(maps: M[], folders: TableState["mapFolders"]) {
  const groups: FolderGroup<M>[] = Object.entries(folders ?? {})
    .map(([id, f]) => ({ id, name: f.name, maps: [] as M[] }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const byId = new Map(groups.map((g) => [g.id, g]));
  const loose: M[] = [];
  for (const m of maps) {
    const g = m.folder ? byId.get(m.folder) : undefined;
    if (g) g.maps.push(m);
    else loose.push(m);
  }
  return { folders: groups, loose };
}
