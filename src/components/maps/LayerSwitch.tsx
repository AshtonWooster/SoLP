import { useEffect, useRef, useState } from "react";
import { TABLE_LAYERS, type TableLayer } from "../../../shared/maps.ts";

const ICONS: Record<TableLayer, string> = { tokens: "♟", assets: "▧", pins: "📍" };

/**
 * The small button at the bottom left of the GM's map: picks which layer clicks on the map work on
 * (tokens as usual, or dragging assets or pins around), as in the map editor.
 */
export function LayerSwitch({
  layer,
  onLayer,
  snap,
  onSnap,
}: {
  layer: TableLayer;
  onLayer: (l: TableLayer) => void;
  snap: boolean;
  onSnap: (on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const current = TABLE_LAYERS.find((l) => l.key === layer)!;
  return (
    <div className="layer-switch" ref={ref}>
      {open && (
        <div className="layer-menu" role="radiogroup" aria-label="Map layer">
          <h4>Work on</h4>
          {TABLE_LAYERS.map((l) => (
            <button
              key={l.key}
              role="radio"
              aria-checked={l.key === layer}
              className={"layer-option" + (l.key === layer ? " on" : "")}
              onClick={() => {
                onLayer(l.key);
                setOpen(false);
              }}
            >
              <span className="layer-icon" aria-hidden="true">
                {ICONS[l.key]}
              </span>
              <span>
                {l.label}
                <span className="muted small">{l.hint}</span>
              </span>
            </button>
          ))}
          <label className="me-check">
            <input type="checkbox" checked={snap} onChange={(e) => onSnap(e.target.checked)} /> Snap to grid
          </label>
        </div>
      )}
      <button
        className={"layer-button" + (layer !== "tokens" ? " editing" : "")}
        aria-expanded={open}
        aria-haspopup="true"
        title="Switch the map layer you're working on"
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">{ICONS[layer]}</span> {current.label}
      </button>
    </div>
  );
}
