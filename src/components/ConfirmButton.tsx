import { useEffect, useState, type ReactNode } from "react";

/**
 * A button that asks for a second click instead of a popup: the first click turns it light red
 * with the confirm label; a second click within the window runs the action. Otherwise it goes back.
 */
export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = "Confirm?",
  className = "",
  ms = 1200,
  ...rest
}: {
  onConfirm: () => void;
  children: ReactNode;
  confirmLabel?: ReactNode;
  className?: string;
  /** How long the confirm state lasts. */
  ms?: number;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "children" | "className">) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), ms);
    return () => clearTimeout(t);
  }, [armed, ms]);
  return (
    <button
      type="button"
      {...rest}
      className={`${className} confirm-button${armed ? " armed" : ""}`.trim()}
      aria-live="polite"
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}
