import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDrag } from "../drag.ts";

/** Popups currently open, oldest first. */
const open: symbol[] = [];

/**
 * A full-screen popup over the player screen. Closing it returns to exactly where you were.
 * It's drawn straight into <body> so nothing it's opened from (like the board's token popup, which
 * some themes clip to its shape) can hide it or tuck it behind the map.
 */
export function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  // Escape closes only the topmost popup (e.g. a Page opened from Cycle characters).
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const me = Symbol();
    open.push(me);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && open[open.length - 1] === me && close.current();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      open.splice(open.indexOf(me), 1);
    };
  }, []);
  const drag = useDrag<HTMLDivElement>();
  const backdrop = useBackdropClose(onClose);
  return createPortal(
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title} {...backdrop}>
      <div className="overlay-box" ref={drag.ref} style={drag.style}>
        <header className="overlay-head" {...drag.handle}>
          <h2>{title}</h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="overlay-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Clicking the dimmed area around a popup closes it, but only a click that starts and ends there:
 * letting go of a dragged popup over the backdrop leaves it open.
 */
export function useBackdropClose(onClose: () => void) {
  const downOnBackdrop = useRef(false);
  return {
    onPointerDown: (e: React.PointerEvent) => (downOnBackdrop.current = e.target === e.currentTarget),
    onClick: (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && downOnBackdrop.current) onClose();
      downOnBackdrop.current = false;
    },
  };
}
