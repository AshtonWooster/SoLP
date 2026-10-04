/** Random id that also works on plain-http LAN pages, where crypto.randomUUID is unavailable. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A fair roll of one die with the given number of sides. */
export function rollDie(sides: number): number {
  // Reject the top sliver of values so every face is equally likely.
  const limit = Math.floor(0x100000000 / sides) * sides;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return 1 + (buf[0] % sides);
}
