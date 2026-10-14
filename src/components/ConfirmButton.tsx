import { useEffect, useId, useState, type ReactNode } from "react";
import { StableLabel } from "./StableLabel.tsx";

/**
 * A button that asks for a second click instead of a popup: the first click turns it light red
 * with the confirm label; a second click within the window runs the action. Otherwise it goes back.
 * The button keeps its size while it asks, so nothing around it moves: keep `confirmLabel` short
 * ("Delete?") and put anything longer in `confirmHint`, which floats under the button.
 */
export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = "Sure?",
  confirmHint,
  className = "",
  ms = 1200,
  ...rest
}: {
  onConfirm: () => void;
  children: ReactNode;
  confirmLabel?: ReactNode;
  /** A longer note shown under the button while it asks, e.g. what stays behind. */
  confirmHint?: string;
  className?: string;
  /** How long the confirm state lasts. */
  ms?: number;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "children" | "className">) {
  const [armed, setArmed] = useState(false);
  // The hint opens toward the middle of the screen, so it never runs off the edge.
  const [hintSide, setHintSide] = useState<"left" | "right">("right");
  const hintId = useId();
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
      aria-describedby={armed && confirmHint ? hintId : undefined}
      onClick={(e) => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          const box = e.currentTarget.getBoundingClientRect();
          setHintSide(box.left + box.width / 2 < window.innerWidth / 2 ? "left" : "right");
          setArmed(true);
        }
      }}
    >
      <StableLabel labels={[children, confirmLabel]} show={armed ? 1 : 0} />
      {armed && confirmHint && (
        <span id={hintId} className={`confirm-hint ${hintSide}`} role="status">
          {confirmHint}
        </span>
      )}
    </button>
  );
}
