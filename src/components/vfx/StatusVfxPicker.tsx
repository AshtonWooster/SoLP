import { useState } from "react";
import { Link } from "react-router-dom";
import { doc, setDoc } from "firebase/firestore";
import { cleanVfx, linkStatus, playLabel, type VfxDef } from "../../../shared/vfx.ts";
import { db, friendlyError } from "../../firebase.ts";

/**
 * In the Effect library, on a status effect (GM only): the VFX that play on it, to add or take off,
 * and a way into the VFX editor to make a new one.
 */
export function StatusVfxPicker({ gameId, statusId, library }: { gameId: string; statusId: string; library: Record<string, VfxDef> | undefined }) {
  const [error, setError] = useState("");
  const all = Object.entries(library ?? {})
    .map(([id, d]) => [id, cleanVfx(d)] as const)
    .sort((a, b) => a[1].name.localeCompare(b[1].name));
  const linked = all.filter(([, d]) => d.statuses.includes(statusId));
  const others = all.filter(([, d]) => !d.statuses.includes(statusId));
  const set = (id: string, d: VfxDef, on: boolean) =>
    setDoc(doc(db, "games", gameId, "vfx", id), cleanVfx({ ...linkStatus(d, statusId, on), updatedAt: Date.now() })).then(
      () => setError(""),
      (e) => setError(friendlyError(e)),
    );
  return (
    <div className="vfx-picker row wrap" aria-label="VFX">
      <span className="muted small">VFX</span>
      {linked.map(([id, d]) => (
        <span key={id} className="chip static">
          {d.name || "Unnamed"}
          {d.play !== "loop" && <span className="muted">&nbsp;· {playLabel(d.play)}</span>}
          <button type="button" className="chip-x" aria-label={`Take ${d.name} off`} onClick={() => set(id, d, false)}>
            ✕
          </button>
        </span>
      ))}
      {others.length > 0 && (
        <select
          aria-label="Add a VFX"
          value=""
          onChange={(e) => {
            const pick = others.find(([id]) => id === e.target.value);
            if (pick) set(pick[0], pick[1], true);
          }}
        >
          <option value="">{linked.length ? "Add another…" : "Add a VFX…"}</option>
          {others.map(([id, d]) => (
            <option key={id} value={id}>
              {d.name || "Unnamed"}
            </option>
          ))}
        </select>
      )}
      <Link to={`/games/${gameId}/vfx`} className="small">
        {all.length ? "Open the VFX editor" : "Make one in the VFX editor"}
      </Link>
      {error && <span className="error small">{error}</span>}
    </div>
  );
}
