// What the popup shows when a token on the map is clicked: the character's gear and Combat Deck.
import type { Character, Page } from "./character.ts";
import { cleanDeck, equipmentPages } from "./ruleset.ts";
import type { Token } from "./types.ts";

export interface TokenGear {
  weapons: { id: string; name: string; hands: 1 | 2 }[];
  armor?: { name: string };
  augment?: { name: string; passives: string[] };
  /** The Combat Deck: each Page with its copies. */
  deck: { page: Page; copies: number }[];
}

/**
 * A token's gear and deck. `source` is the character it stands for: the player's character
 * sheet, or the GM character it was placed from. A GM character's deck is the token's own (the GM
 * may have changed it since placing it); a player's comes from their sheet.
 */
export function tokenGear(token: Token, source?: Character): TokenGear {
  const gear: TokenGear = {
    weapons: (source?.weapons ?? []).map((w) => ({ id: w.id, name: w.name.trim() || "Unnamed weapon", hands: w.hands })),
    deck: [],
  };
  if (source?.armor) gear.armor = { name: source.armor.name.trim() || "Unnamed armor" };
  const aug = source?.augment;
  if (aug && (aug.name.trim() || aug.passives.length)) {
    gear.augment = { name: aug.name.trim() || "Unnamed augment", passives: aug.passives.map((p) => p.name.trim() || "Unnamed passive") };
  }
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
