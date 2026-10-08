import { useEffect, useState } from "react";

/** A number box that saves on Enter or when you click away, and follows changes made elsewhere. */
export function NumberField({ value, onCommit, label, step }: { value: number; onCommit: (n: number) => void; label?: string; step?: number }) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);
  const commit = () => {
    setEditing(false);
    const n = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(n) && n !== value) onCommit(n);
    else setDraft(String(value));
  };
  return (
    <input
      type="number"
      aria-label={label}
      step={step}
      value={draft}
      onFocus={() => setEditing(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
    />
  );
}
