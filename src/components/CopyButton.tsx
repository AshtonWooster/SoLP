import { useEffect, useState } from "react";

/** Copies some text to the clipboard, then says so for a moment. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"" | "copied" | "failed">("");
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
      {state === "copied" ? "Copied ✓" : state === "failed" ? "Couldn't copy" : label}
    </button>
  );
}
