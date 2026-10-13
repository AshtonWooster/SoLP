import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { HOME, isHome, MAX_ZOOM, MIN_ZOOM, panBy, viewTransform, wheelFactor, ZOOM_STEP, zoomAt, type Point, type View } from "../zoom.ts";

/** How far a press has to move before it counts as a drag instead of a click. */
const DRAG_PX = 4;

type Gesture =
  | { kind: "pan"; id: number; last: Point; start: Point; dragging: boolean }
  | { kind: "pinch"; dist: number; mid: Point };

/**
 * The battle map with zoom and pan, and its buttons above it. Scroll to zoom where the pointer is,
 * hold the middle mouse button to drag the map around, pinch on a phone, or turn on Pan to drag
 * with the left button or one finger. Everything on the map (tiles, tokens, fog, pins, arrows)
 * zooms together, so clicks still land on the tile under the pointer. Remount it with a new `key`
 * to go back to the whole map, e.g. when the map changes.
 */
export function MapView({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>(HOME);
  const [panMode, setPanMode] = useState(false);
  const [dragging, setDragging] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const gesture = useRef<Gesture | null>(null);
  const touches = useRef(new Map<number, Point>());
  // A drag ends in a click on whatever was under it; that click shouldn't do anything.
  const swallowClick = useRef(false);

  /** A point on screen as a fraction of the map's box. */
  const frac = (p: Point): Point => {
    const b = boxRef.current!.getBoundingClientRect();
    return { x: (p.x - b.left) / (b.width || 1), y: (p.y - b.top) / (b.height || 1) };
  };
  const pinchOf = (): { dist: number; mid: Point } => {
    const [a, b] = [...touches.current.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: frac({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }) };
  };

  // The wheel listener has to be a real one (not React's) so it can stop the page from scrolling.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      const factor = wheelFactor(e.deltaY, e.deltaMode);
      const v = viewRef.current;
      // Scrolling down on the whole map scrolls the page as usual.
      if (!e.ctrlKey && ((factor < 1 && v.scale <= MIN_ZOOM) || (factor > 1 && v.scale >= MAX_ZOOM))) return;
      e.preventDefault();
      const at = frac({ x: e.clientX, y: e.clientY });
      setView((cur) => zoomAt(cur, factor, at));
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (!panMode) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPanMode(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panMode]);

  // Popups drawn into <body> from inside the map still pass their events up through it; leave those be.
  const onMap = (e: { target: EventTarget }) => !!boxRef.current?.contains(e.target as Node);
  const startPan = (e: ReactPointerEvent, now: boolean) => {
    gesture.current = { kind: "pan", id: e.pointerId, last: { x: e.clientX, y: e.clientY }, start: { x: e.clientX, y: e.clientY }, dragging: now };
    if (now) {
      boxRef.current!.setPointerCapture?.(e.pointerId);
      setDragging(true);
    }
  };

  return (
    <div className="map-view">
      <div className="map-zoom-bar" role="toolbar" aria-label="Map view">
        <button type="button" onClick={() => setView((v) => zoomAt(v, 1 / ZOOM_STEP))} disabled={view.scale <= MIN_ZOOM} title="Zoom out (or scroll down on the map)" aria-label="Zoom out">
          −
        </button>
        <span className="map-zoom-level" aria-live="polite">
          {Math.round(view.scale * 100)}%
        </span>
        <button type="button" onClick={() => setView((v) => zoomAt(v, ZOOM_STEP))} disabled={view.scale >= MAX_ZOOM} title="Zoom in (or scroll up on the map)" aria-label="Zoom in">
          +
        </button>
        <button
          type="button"
          className={panMode ? "on" : ""}
          aria-pressed={panMode}
          onClick={() => setPanMode((p) => !p)}
          title={panMode ? "Stop panning (Esc)" : "Drag the map with the left button or one finger. You can also hold the middle mouse button anywhere on the map."}
        >
          ✥ Pan
        </button>
        <button type="button" onClick={() => setView(HOME)} disabled={isHome(view)} title="Show the whole map again">
          ⟲ Reset view
        </button>
      </div>
      <div
        ref={boxRef}
        className={"map-viewport" + (panMode ? " pan-mode" : "") + (dragging ? " dragging" : "") + (panMode || !isHome(view) ? " no-touch-scroll" : "")}
        onPointerDownCapture={(e) => {
          if (!onMap(e)) return;
          swallowClick.current = false;
          if (e.pointerType === "touch") {
            touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (touches.current.size === 2) {
              // A second finger turns whatever the first one was doing into a pinch.
              e.stopPropagation();
              gesture.current = { kind: "pinch", ...pinchOf() };
              for (const id of touches.current.keys()) boxRef.current!.setPointerCapture?.(id);
              swallowClick.current = true;
              setDragging(true);
              return;
            }
          }
          if (e.button === 1) {
            // Middle button: pan right away, and don't start the browser's auto-scroll.
            e.preventDefault();
            e.stopPropagation();
            startPan(e, true);
          } else if (panMode && e.button === 0) {
            // In pan mode a press drags the map instead of drawing fog; a plain click still clicks.
            e.stopPropagation();
            startPan(e, false);
          }
        }}
        onPointerDown={(e) => {
          // Zoomed in on a touch screen, one finger drags the map (unless something under it, like fog drawing, took the press).
          if (onMap(e) && e.pointerType === "touch" && !gesture.current && !isHome(viewRef.current)) startPan(e, false);
        }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (!g) return;
          const b = boxRef.current!.getBoundingClientRect();
          if (g.kind === "pinch") {
            if (!touches.current.has(e.pointerId)) return;
            touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const now = pinchOf();
            const move = { x: now.mid.x - g.mid.x, y: now.mid.y - g.mid.y };
            setView((v) => panBy(zoomAt(v, now.dist / g.dist, g.mid), move));
            gesture.current = { kind: "pinch", ...now };
            return;
          }
          if (e.pointerId !== g.id) return;
          if (!g.dragging) {
            if (Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) < DRAG_PX) return;
            g.dragging = true;
            boxRef.current!.setPointerCapture?.(e.pointerId);
            setDragging(true);
          }
          const d = { x: (e.clientX - g.last.x) / (b.width || 1), y: (e.clientY - g.last.y) / (b.height || 1) };
          g.last = { x: e.clientX, y: e.clientY };
          setView((v) => panBy(v, d));
        }}
        onPointerUp={(e) => end(e)}
        onPointerCancel={(e) => end(e)}
        onClickCapture={(e) => {
          if (!swallowClick.current) return;
          swallowClick.current = false;
          e.preventDefault();
          e.stopPropagation();
        }}
        onAuxClick={(e) => e.button === 1 && e.preventDefault()}
      >
        <div className="map-stage" style={isHome(view) ? undefined : { transform: viewTransform(view) }}>
          {children}
        </div>
      </div>
    </div>
  );

  function end(e: ReactPointerEvent) {
    touches.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pinch") {
      // Lifting one finger of a pinch ends it; the other one doesn't start a new drag.
      if (touches.current.size < 2) {
        gesture.current = null;
        setTimeout(() => (swallowClick.current = false));
      }
    } else if (e.pointerId === g.id) {
      if (g.dragging && e.button !== 1) {
        swallowClick.current = true;
        setTimeout(() => (swallowClick.current = false));
      }
      gesture.current = null;
    }
    if (!gesture.current) setDragging(false);
  }
}
