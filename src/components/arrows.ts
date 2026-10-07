import type { TableState, Token } from "../../shared/types.ts";

/** One arrow on the board, and the slotted Pages it stands for (two when it is a clash). */
export interface BoardArrow {
  id: string;
  from: Token;
  to: Token;
  clash: boolean;
  /** A head at both ends: two Pages clashing with each other. */
  both: boolean;
  /** The slots to show when the arrow is tapped: the Page, and for a clash the Page it meets. */
  slotIds: string[];
}

/**
 * An arrow from each slotted Page's owner to its target(s). Two Pages clashing with each other
 * are one arrow with a head at each end.
 */
export function boardArrows(state: TableState): BoardArrow[] {
  const slots = state.combat?.slots ?? [];
  return slots.flatMap((s) => {
    const partner = s.clashWith ? slots.find((x) => x.id === s.clashWith) : undefined;
    const slotIds = partner ? [s.id, partner.id] : [s.id];
    if (partner && partner.clashWith === s.id) {
      if (s.id > partner.id) return [];
      const a = { id: `${s.id}-${partner.id}`, from: state.tokens[s.ownerId], to: state.tokens[partner.ownerId], clash: true, both: true, slotIds };
      return a.from && a.to ? [a] : [];
    }
    return s.targets
      .map((t) => ({ id: `${s.id}-${t.tokenId}`, from: state.tokens[s.ownerId], to: state.tokens[t.tokenId], clash: !!s.clashWith, both: false, slotIds }))
      .filter((a): a is BoardArrow => !!a.from && !!a.to);
  });
}

/** The slotted Pages behind an arrow, each with its Page, skipping any that are gone. */
export function arrowPages(state: TableState, slotIds: string[]) {
  const c = state.combat;
  if (!c) return [];
  return slotIds.flatMap((id) => {
    const slot = c.slots.find((s) => s.id === id);
    const page = slot && c.pages[slot.pageId];
    return slot && page ? [{ slot, page, owner: state.tokens[slot.ownerId] as Token | undefined }] : [];
  });
}

/**
 * The tappable part of an arrow, in tiles: the line between the two token centres with the ends
 * cut back, so tapping a token still hits the token and not the arrow over it.
 */
export function arrowHitSegment(a: Pick<BoardArrow, "from" | "to">, trim = 0.4) {
  const x1 = a.from.x + 0.5, y1 = a.from.y + 0.5, x2 = a.to.x + 0.5, y2 = a.to.y + 0.5;
  const len = Math.hypot(x2 - x1, y2 - y1);
  // Neighbours: keep a short stub in the middle so the arrow can still be tapped.
  const cut = len > 0 ? Math.min(trim, len * 0.35) / len : 0;
  return { x1: x1 + (x2 - x1) * cut, y1: y1 + (y2 - y1) * cut, x2: x2 - (x2 - x1) * cut, y2: y2 - (y2 - y1) * cut };
}
