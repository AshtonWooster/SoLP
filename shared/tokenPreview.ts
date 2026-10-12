// What the popup shows when a token on the map is clicked: the character's gear and Combat Deck.
import type { Character, Page } from "./character.ts";
import { cleanDeck, equipmentPages, gearNames } from "./ruleset.ts";
import type { Token, TokenGearInfo } from "./types.ts";

export interface TokenGear extends TokenGearInfo {
  /** The Combat Deck: each Page with its copies. */
  deck: { page: Page; copies: number }[];
}

/**
 * A token's gear and deck. `source` is the character it stands for: the player's character
 * sheet, or the GM character it was placed from. A GM character's deck is the token's own (the GM
 * may have changed it since placing it); a player's comes from their sheet. Without a source (on
 * players' screens), a GM character shows the gear it was placed with.
 */
export function tokenGear(token: Token, source?: Character): TokenGear {
  const gear: TokenGear = { ...(source ? gearNames(source) : (token.gear ?? { weapons: [] })), deck: [] };
  if (token.side === "player") {
    if (source) {
      const pages = new Map(equipmentPages(source).map((s) => [s.page.id, s.page]));
      gear.deck = cleanDeck(source).map((e) => ({ page: pages.get(e.pageId)!, copies: e.copies }));
    }
  } else {
    // Like enemyDeck: the copies the GM set, or one of each Page if none were set.
    const pages = token.pages ?? [];
    const byId = new Map(pages.map((p) => [p.id, p]));
    gear.deck = token.deck?.length
      ? token.deck.filter((e) => byId.has(e.pageId) && e.copies > 0).map((e) => ({ page: byId.get(e.pageId)!, copies: e.copies }))
      : pages.map((page) => ({ page, copies: 1 }));
  }
  return gear;
}
