const LABELS = {
  hosting: ["ok", "Hosting"],
  connected: ["ok", "Live"],
  starting: ["bad", "Starting…"],
  connecting: ["bad", "Connecting…"],
  unreachable: ["bad", "Reconnecting…"],
  waiting: ["bad", "Waiting for GM"],
  replaced: ["bad", "Not hosting"],
  error: ["bad", "Error"],
  closed: ["bad", "Disconnected"],
} as const;

export function ConnectionBadge({ status }: { status: keyof typeof LABELS }) {
  const [cls, label] = LABELS[status];
  return <span className={"badge " + cls}>{label}</span>;
}
