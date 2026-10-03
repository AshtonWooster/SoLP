import { useConnected } from "../socket.ts";

export function ConnectionBadge() {
  const connected = useConnected();
  return <span className={"badge " + (connected ? "ok" : "bad")}>{connected ? "Live" : "Reconnecting…"}</span>;
}
