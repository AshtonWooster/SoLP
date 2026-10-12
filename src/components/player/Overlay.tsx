import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

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
  return createPortal(
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="overlay-box" onClick={(e) => e.stopPropagation()}>
        <header className="overlay-head">
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
