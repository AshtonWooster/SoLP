import { useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { assetId, type LibraryEntry, libraryEntries, type MapAsset, newAsset, removedAsset, searchLibrary } from "../../../shared/mapAssets.ts";
import type { MapInfo } from "../../../shared/types.ts";
import { useCollection } from "../../api.ts";
import { db, friendlyError } from "../../firebase.ts";
import { ConfirmButton } from "../ConfirmButton.tsx";
import { IMAGE_ACCEPT, useImageUpload } from "../ImageUpload.tsx";
import { StableLabel } from "../StableLabel.tsx";

/** The drag type for an image dragged from the library onto the map. */
export const ASSET_DRAG_TYPE = "application/x-solp-asset";

/** Save a new upload to the game's library, so it can be placed again later. */
export function saveToLibrary(gameId: string, url: string, fileName: string): Promise<void> {
  return setDoc(doc(db, "games", gameId, "mapAssets", assetId(url)), newAsset(url, fileName));
}

/** The GM's choice to keep the library open, remembered on this device. */
function useLibraryOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem("solp.assetLibrary") !== "closed";
    } catch {
      return true;
    }
  });
  return [
    open,
    (on) => {
      setOpen(on);
      try {
        localStorage.setItem("solp.assetLibrary", on ? "open" : "closed");
      } catch {
        /* private window: just not remembered */
      }
    },
  ];
}

/**
 * The left side of the map editor: every image uploaded for this game's maps. Click one (or drag it
 * onto the map) to place it again without uploading it twice; upload new ones here too.
 */
export function AssetLibrary({
  gameId,
  maps,
  onPlace,
  onUploaded,
}: {
  gameId: string;
  /** All of the game's maps, to count where each image is used and include images placed before the library. */
  maps: Pick<MapInfo, "items">[];
  onPlace: (url: string, name: string) => void;
  /** A new upload (already saved to the library) to put on the map, with the file's name. */
  onUploaded: (url: string, fileName: string) => void;
}) {
  const saved = useCollection<MapAsset>(`games/${gameId}/mapAssets`);
  const [open, setOpen] = useLibraryOpen();
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const { busy, pick, editor } = useImageUpload(
    `games/${gameId}/assets/maps`,
    "mapImage",
    (url, file) => {
      saveToLibrary(gameId, url, file.name).catch((e) => setError(friendlyError(e)));
      onUploaded(url, file.name);
    },
    setError,
  );
  const entries = libraryEntries(saved, maps);
  const shown = searchLibrary(entries, search);

  const remove = (e: LibraryEntry) => {
    setError("");
    setDoc(doc(db, "games", gameId, "mapAssets", e.id), removedAsset(e)).catch((err) => setError(friendlyError(err)));
  };

  if (!open) {
    return (
      <aside className="me-library closed" aria-label="Asset library">
        <button className="me-library-rail" onClick={() => setOpen(true)} title="Show the asset library" aria-label="Show the asset library" aria-expanded={false}>
          <span aria-hidden="true">🖼</span>
          <span className="me-library-rail-label">Assets{entries.length ? ` (${entries.length})` : ""}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="me-library" aria-label="Asset library">
      <div className="me-library-head">
        <h4>Asset library</h4>
        <button className="icon" onClick={() => setOpen(false)} title="Hide the asset library" aria-label="Hide the asset library" aria-expanded>
          «
        </button>
      </div>
      <label className={"button-like me-library-upload" + (busy ? " disabled" : "")} title="Upload an image to the library and place it on this map">
        <StableLabel labels={["＋ Upload image", "Uploading…"]} show={busy ? 1 : 0} />
        <input
          type="file"
          accept={IMAGE_ACCEPT}
          hidden
          aria-label="Upload an image to the library"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            pick(file);
          }}
        />
      </label>
      {entries.length > 6 && <input type="search" aria-label="Search the asset library" placeholder="Search assets" value={search} onChange={(e) => setSearch(e.target.value)} />}
      {error && <span className="error small">{error}</span>}
      {saved && entries.length === 0 && <p className="muted small">Images you upload for your maps are kept here, so you can place them again on any map.</p>}
      {entries.length > 0 && shown.length === 0 && <p className="muted small">No assets match “{search}”.</p>}
      <ul className="plain me-library-grid">
        {shown.map((e) => (
          <li key={e.id} className="me-library-item">
            <button
              className="me-library-thumb"
              onClick={() => onPlace(e.url, e.name)}
              draggable
              onDragStart={(ev) => {
                ev.dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify({ url: e.url, name: e.name }));
                ev.dataTransfer.effectAllowed = "copy";
              }}
              title={`${e.name}: click to place on this map, or drag it where you want it`}
              aria-label={`Place ${e.name} on this map`}
            >
              <img src={e.url} alt="" draggable={false} />
              {e.uses > 0 && (
                <span className="me-library-uses" title={`Placed ${e.uses} time${e.uses === 1 ? "" : "s"} on this game's maps`}>
                  ×{e.uses}
                </span>
              )}
            </button>
            <span className="me-library-name small" title={e.name}>
              {e.name}
            </span>
            <ConfirmButton
              className="icon me-library-remove"
              confirmLabel="×"
              confirmHint="Tap again to remove it from the library"
              onConfirm={() => remove(e)}
              title="Remove from the library (it stays on any map it's already on)"
              aria-label={`Remove ${e.name} from the library`}
            >
              ×
            </ConfirmButton>
          </li>
        ))}
      </ul>
      {entries.length > 0 && <p className="muted small me-help">Click to place in the middle of your view, or drag onto the map.</p>}
      {editor}
    </aside>
  );
}
