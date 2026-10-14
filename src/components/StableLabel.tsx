import type { ReactNode } from "react";

/**
 * A label that changes (Copy → Copied, Save → Saving…) without changing the button's size: every
 * label sits in the same spot and only the current one shows, so the button is always as wide as
 * the longest. That keeps the button, and everything next to it, from moving when the text swaps.
 */
export function StableLabel({ labels, show }: { labels: ReactNode[]; show: number }) {
  return (
    <span className="stable-label">
      {labels.map((label, i) => (
        <span key={i} className={i === show ? "on" : undefined} aria-hidden={i === show ? undefined : true}>
          {label}
        </span>
      ))}
    </span>
  );
}
