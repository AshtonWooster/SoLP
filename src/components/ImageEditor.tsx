import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clampCrop, coverScale, defaultCrop, frameAspect, type ImageCrop, type ImageKind, MAX_ZOOM } from "../imageSize.ts";

/** Biggest side of the framing box on screen, in CSS pixels. */
const BOX = 360;

/**
 * Frame an image before it's uploaded: drag to move it, zoom, turn it a quarter at a time or
 * straighten it a little. The frame has the shape the image is shown in.
 * It's drawn straight into <body> so the card it's opened from (like a Page in the sticky
 * equipment editor) can't tuck it behind the cards beside it.
 */
export function ImageEditor({ file, kind, title = "Adjust image", onDone, onCancel }: { file: File; kind: ImageKind; title?: string; onDone: (crop: ImageCrop) => void; onCancel: () => void }) {
  const [url] = useState(() => URL.createObjectURL(file));
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [quarter, setQuarter] = useState(0);
  const [fine, setFine] = useState(0);
  const [view, setView] = useState({ zoom: 1, cx: 0, cy: 0 });
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const [boxMax, setBoxMax] = useState(BOX);
  useEffect(() => {
    const fit = () => setBoxMax(Math.min(BOX, window.innerWidth - 72));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const rotation = quarter * 90 + fine;
  const w = natural?.width ?? 1;
  const h = natural?.height ?? 1;
  const aspect = frameAspect(kind, w, h, rotation);
  const frameW = aspect >= 1 ? boxMax : boxMax * aspect;
  const frameH = aspect >= 1 ? boxMax / aspect : boxMax;
  const crop = clampCrop({ rotation, ...view }, w, h, aspect);
  const scale = coverScale(w, h, rotation, frameW, frameH) * crop.zoom;

  const set = (next: Partial<ImageCrop>) => setView((v) => {
    const c = clampCrop({ rotation, ...v, ...next }, w, h, aspect);
    return { zoom: c.zoom, cx: c.cx, cy: c.cy };
  });
  /** Move the picture by a drag of (dx, dy) screen pixels: the frame's center goes the other way, in the image's own axes. */
  const pan = (dx: number, dy: number) => {
    const a = (rotation * Math.PI) / 180;
    set({ cx: crop.cx - (dx * Math.cos(a) + dy * Math.sin(a)) / scale, cy: crop.cy - (-dx * Math.sin(a) + dy * Math.cos(a)) / scale });
  };
  const reset = () => {
    setQuarter(0);
    setFine(0);
    if (natural) setView({ zoom: 1, cx: natural.width / 2, cy: natural.height / 2 });
  };

  return createPortal(
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="overlay-box image-editor">
        <div className="overlay-head">
          <h2>{title}</h2>
          <button className="icon" aria-label="Cancel" onClick={onCancel}>
            ✕
          </button>
        </div>
        <div className="overlay-body">
          <div
            className="ie-frame"
            style={{ width: frameW, height: frameH }}
            tabIndex={0}
            aria-label="Drag to move the image; arrow keys nudge it"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || d.id !== e.pointerId) return;
              pan(e.clientX - d.x, e.clientY - d.y);
              drag.current = { ...d, x: e.clientX, y: e.clientY };
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onWheel={(e) => set({ zoom: crop.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1) })}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 40 : 10;
              const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
              const m = moves[e.key];
              if (!m) return;
              e.preventDefault();
              pan(m[0], m[1]);
            }}
          >
            <img
              src={url}
              alt=""
              draggable={false}
              onLoad={(e) => {
                const { naturalWidth: nw, naturalHeight: nh } = e.currentTarget;
                setNatural({ width: nw, height: nh });
                const c = defaultCrop(nw, nh);
                setView({ zoom: c.zoom, cx: c.cx, cy: c.cy });
              }}
              style={
                natural
                  ? { width: w, height: h, transform: `rotate(${rotation}deg) scale(${scale}) translate(${-crop.cx}px, ${-crop.cy}px)` }
                  : { visibility: "hidden" }
              }
            />
            {!natural && <span className="muted small ie-loading">Loading…</span>}
          </div>
          <div className="ie-controls">
            <label className="ie-slider">
              <span className="small">Zoom</span>
              <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={crop.zoom} onChange={(e) => set({ zoom: +e.target.value })} aria-label="Zoom" />
            </label>
            <label className="ie-slider">
              <span className="small">Straighten</span>
              <input type="range" min={-45} max={45} step={0.5} value={fine} onChange={(e) => setFine(+e.target.value)} aria-label="Straighten" />
            </label>
            <div className="row wrap">
              <button type="button" onClick={() => setQuarter((q) => (q + 3) % 4)} aria-label="Turn left">
                ⟲ Turn left
              </button>
              <button type="button" onClick={() => setQuarter((q) => (q + 1) % 4)} aria-label="Turn right">
                ⟳ Turn right
              </button>
              <button type="button" className="link" onClick={reset}>
                Reset
              </button>
            </div>
          </div>
          <p className="muted small">Drag the picture to move it, scroll or use the slider to zoom.</p>
          <div className="row wrap ie-actions">
            <button type="button" className="big-button" disabled={!natural} onClick={() => onDone(crop)}>
              Use image
            </button>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
