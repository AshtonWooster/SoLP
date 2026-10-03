export function ConnectionBadge({ offline }: { offline: boolean }) {
  return <span className={"badge " + (offline ? "bad" : "ok")}>{offline ? "Reconnecting…" : "Live"}</span>;
}
