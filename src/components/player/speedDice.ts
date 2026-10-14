import type { Page } from "../../../shared/character.ts";
import { isMassAttack } from "../../../shared/ruleset.ts";
import type { SlottedPage, TableState } from "../../../shared/types.ts";

/** One target of a slotted Page, with the Page answering it (if any). */
export interface DieTarget {
  tokenId: string;
  /** Clashing with this Page, or defending against this Mass Attack with it. */
  response?: SlottedPage;
  responsePage?: Page;
}

/** One of a character's Speed Dice: the Page on it and who it's aimed at. */
export interface SpeedDieView {
  die: number;
  slot?: SlottedPage;
  page?: Page;
  mass: boolean;
  targets: DieTarget[];
}

/** The Page answering this one: clashing with it, or defending against this Mass Attack on that target. */
export function responseTo(table: TableState, slot: SlottedPage, targetId: string): SlottedPage | undefined {
  const c = table.combat;
  return c?.slots.find((s) => s.ownerId === targetId && (s.clashWith === slot.id || slot.clashWith === s.id));
}

/** Each of a character's Speed Dice this round, in order, with its Page, targets and responses. */
export function speedDiceOf(table: TableState, tokenId: string): SpeedDieView[] {
  const c = table.combat;
  const dice = c?.order.find((x) => x.tokenId === tokenId)?.dice ?? 0;
  if (!c) return [];
  return Array.from({ length: dice }, (_, die) => {
    const slot = c.slots.find((s) => s.ownerId === tokenId && s.die === die);
    const page = slot && c.pages[slot.pageId];
    const targets = (slot?.targets ?? []).map((t) => {
      const response = slot && responseTo(table, slot, t.tokenId);
      return { tokenId: t.tokenId, response, responsePage: response && c.pages[response.pageId] };
    });
    return { die, slot, page, mass: !!page && isMassAttack(page.type), targets };
  });
}
