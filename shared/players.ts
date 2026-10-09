// The player list on a game's main menu: each player's username, with a preview of their character under it.
import type { Character } from "./character.ts";
import type { GameDoc } from "./types.ts";

export interface PlayerListEntry {
  uid: string;
  /** The player's username. */
  username: string;
  /** Their character's name and picture; absent until they make one. */
  character?: { name: string; portrait?: string };
  /** Where the preview links to: the character page, for the GM only. */
  href?: string;
}

/** The game's players in join order. Only the GM gets a link to each character page. */
export function playerList(gameId: string, game: GameDoc, characters: Record<string, Character> | undefined, viewerIsGm: boolean): PlayerListEntry[] {
  return Object.entries(game.members)
    .filter(([, m]) => m.role === "player")
    .map(([uid, m]) => {
      const c = characters?.[uid];
      const entry: PlayerListEntry = { uid, username: m.displayName };
      if (c) {
        entry.character = { name: c.name.trim() || "Unnamed character", ...(c.portrait ? { portrait: c.portrait } : {}) };
        if (viewerIsGm) entry.href = `/games/${gameId}/characters/${uid}`;
      }
      return entry;
    });
}
