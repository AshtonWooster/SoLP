import { useEffect, useState } from "react";
import { StableLabel } from "./StableLabel.tsx";

const STATES = ["", "copied", "failed"] as const;

/** Copies some text to the clipboard, then says so for a moment, without the button changing size. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<(typeof STATES)[number]>("");
  useEffect(() => {
    if (!state) return;
    const t = setTimeout(() => setState(""), 1500);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <button
      type="button"
      className="small copy-button"
      aria-live="polite"
      onClick={() =>
        navigator.clipboard
          .writeText(text)
          .then(() => setState("copied"))
          .catch(() => setState("failed"))
      }
    >
      <StableLabel labels={[label, "Copied ✓", "Not copied"]} show={STATES.indexOf(state)} />
    </button>
  );
}
