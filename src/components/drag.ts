import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

export interface Point {
  x: number;
  y: number;
}
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where a dragged popup ends up. `from` is its offset when the drag started, `box` where it was on
 * screen then, and `delta` how far the pointer has moved. It stays inside the window, and one too
 * big to fit keeps its top right corner on screen, so its close button is always in reach.
 */
export function dragOffset(from: Point, delta: Point, box: Box, view: { width: number; height: number }): Point {
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  const left = clamp(box.left + delta.x, Math.min(0, view.width - box.width), view.width - box.width);
  const top = clamp(box.top + delta.y, 0, view.height - box.height);
  return { x: from.x + left - box.left, y: from.y + top - box.top };
}

/** Pressing on these inside a header uses them as usual instead of dragging. */
const NOT_A_HANDLE = "button, input, select, textarea, a, label, summary, [contenteditable]";

/**
 * Lets a popup or menu be moved by dragging its header. Put `ref` and `style` on the box and
 * `handle` on its header.
 */
export function useDrag<T extends HTMLElement = HTMLElement>() {
  const ref = useRef<T>(null);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    const box = ref.current;
    if (!box || e.button !== 0 || (e.target as Element).closest(NOT_A_HANDLE)) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const rect = box.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    const from = offset;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) =>
      setOffset(dragOffset(from, { x: ev.clientX - start.x, y: ev.clientY - start.y }, rect, { width: window.innerWidth, height: window.innerHeight }));
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };
  return {
    ref,
    // --drag-y lets a box dragged down shrink its max-height to match, so it never runs off the bottom.
    style: offset.x || offset.y ? ({ translate: `${offset.x}px ${offset.y}px`, "--drag-y": `${Math.max(0, offset.y)}px` } as CSSProperties) : undefined,
    handle: { onPointerDown, "data-drag-handle": "" },
  };
}
