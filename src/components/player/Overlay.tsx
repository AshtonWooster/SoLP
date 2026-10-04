import { useEffect, type ReactNode } from "react";

/** A full-screen popup over the player screen. Closing it returns to exactly where you were. */
export function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
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
    </div>
  );
}
