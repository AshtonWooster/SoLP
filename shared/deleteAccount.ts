// Deleting your account (account settings): you confirm, see which of your games go with it, then
// type your email and password. deleteAccount (functions/src) checks both again on the server.

/** How recently you must have entered your password for the server to delete the account. */
export const RECENT_SIGN_IN_SECONDS = 5 * 60;

/** Whether what you typed is your account's email. Spaces at either end and letter case don't count. */
export function deleteEmailMatches(typed: string, email: string): boolean {
  const clean = (s: string) => s.trim().toLowerCase();
  return clean(typed) !== "" && clean(typed) === clean(email);
}

/** Whether a sign-in at `authTime` (seconds, from the ID token) is recent enough at `nowMs`. */
export function signedInRecently(authTime: number | undefined, nowMs: number): boolean {
  if (typeof authTime !== "number" || !Number.isFinite(authTime)) return false;
  return nowMs / 1000 - authTime <= RECENT_SIGN_IN_SECONDS;
}
