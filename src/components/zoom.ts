/**
 * Zooming and panning the battle map. A view is how far in the map is zoomed and where its top
 * left corner sits, as a fraction of the box it's shown in (0 to -(scale - 1)), so the view stays
 * put when that box changes size. Each viewer has their own; it isn't shared with the table.
 */
export interface View {
  scale: number;
  x: number;
  y: number;
}
export interface Point {
  x: number;
  y: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
/** How much one press of zoom in or out changes it. */
export const ZOOM_STEP = 1.25;
/** The whole map, as it shows before any zooming. */
export const HOME: View = { scale: 1, x: 0, y: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Keeps the zoom in range and the map covering the whole box, so it can't be dragged off. */
export function clampView(v: View): View {
  const scale = clamp(v.scale, MIN_ZOOM, MAX_ZOOM);
  return { scale, x: clamp(v.x, 1 - scale, 0), y: clamp(v.y, 1 - scale, 0) };
}

/** Zooms by `factor`, keeping the spot under `at` (a fraction of the box) where it is. */
export function zoomAt(v: View, factor: number, at: Point = { x: 0.5, y: 0.5 }): View {
  const scale = clamp(v.scale * factor, MIN_ZOOM, MAX_ZOOM);
  const k = scale / v.scale;
  return clampView({ scale, x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k });
}

/** Moves the map by `d`, a fraction of the box. */
export function panBy(v: View, d: Point): View {
  return clampView({ scale: v.scale, x: v.x + d.x, y: v.y + d.y });
}

/** The spot on the map (0 to 1 across and down) shown at `at` in the box. */
export function mapPoint(v: View, at: Point): Point {
  return { x: (at.x - v.x) / v.scale, y: (at.y - v.y) / v.scale };
}

/** How much one turn of the mouse wheel (or a trackpad pinch) zooms: scrolling up zooms in. */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-clamp(px, -200, 200) * 0.002);
}

export const isHome = (v: View) => v.scale === 1 && v.x === 0 && v.y === 0;

/** The CSS transform that draws the map at this view. */
export const viewTransform = (v: View) => `translate(${v.x * 100}%, ${v.y * 100}%) scale(${v.scale})`;
