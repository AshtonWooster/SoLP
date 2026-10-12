// Deleting a game (game settings): the GM confirms, then types the game's name. deleteGame
// (functions/src) checks the name again on the server and removes everything the game had.

/** Whether what the GM typed is the game's name. Spaces at either end don't count; case does. */
export function deleteNameMatches(typed: string, gameName: string): boolean {
  return typed.trim() !== "" && typed.trim() === gameName.trim();
}
