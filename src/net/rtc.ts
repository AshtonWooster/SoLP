// Shared WebRTC settings for the host (GM screen) and the devices that connect to it.

/**
 * STUN lets two devices on different networks find a direct path to each other.
 * Some networks (many phone carriers, strict school/office Wi-Fi) block direct paths;
 * those need a TURN relay, configured with the VITE_TURN_* variables (see README).
 */
function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  const turnUrls = import.meta.env.VITE_TURN_URLS as string | undefined;
  if (turnUrls) {
    servers.push({
      urls: turnUrls.split(",").map((u) => u.trim()).filter(Boolean),
      username: import.meta.env.VITE_TURN_USERNAME as string | undefined,
      credential: import.meta.env.VITE_TURN_CREDENTIAL as string | undefined,
    });
  }
  return servers;
}

export function newPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers: iceServers() });
}

/**
 * Waits until the connection has gathered its network addresses, so the whole offer or
 * answer can be sent as one Firestore write (instead of one write per address).
 */
export function gathered(pc: RTCPeerConnection, timeoutMs = 4000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => pc.iceGatheringState === "complete" && done();
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

/** Signals older than this are ignored, so a stale request never connects. */
export const SIGNAL_MAX_AGE_MS = 60_000;
