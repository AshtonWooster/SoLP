// Invite codes: how many wrong codes an account may try before joinGame (functions/src) makes it
// wait, so nobody can guess their way into a game. Tracked per account in joinAttempts/{uid},
// which only the Cloud Functions read or write.

/** Wrong codes allowed in one window. */
export const JOIN_MAX_FAILURES = 10;
/** The window: an hour from the first wrong code in it. */
export const JOIN_WINDOW_MS = 60 * 60 * 1000;

export interface JoinAttempts {
  /** When the current window began (the first wrong code in it). */
  since: number;
  /** Wrong codes tried since then. */
  failures: number;
}

/** Whether this account may try another code now. */
export function mayTryCode(a: JoinAttempts | undefined, now: number): boolean {
  return !a || now - a.since >= JOIN_WINDOW_MS || a.failures < JOIN_MAX_FAILURES;
}

/** The record after one more wrong code. */
export function afterWrongCode(a: JoinAttempts | undefined, now: number): JoinAttempts {
  if (!a || now - a.since >= JOIN_WINDOW_MS) return { since: now, failures: 1 };
  return { since: a.since, failures: a.failures + 1 };
}

/** Minutes until this account may try again, for the error message. */
export function minutesUntilRetry(a: JoinAttempts, now: number): number {
  return Math.max(1, Math.ceil((a.since + JOIN_WINDOW_MS - now) / 60000));
}
