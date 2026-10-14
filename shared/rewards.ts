// Rewards and costs in GM popups: a popup can hand out
// or take away an item from the GM's item library and/or Ahn. It settles right away when sent, on
// the popup's Story Roll (a reward is gained on a roll of at least `need`; a cost is lost below it),
// or, for a reward, when the player pays its price in Ahn. The host keeps players' sheets, so it
// reads and saves them through SheetAccess; the table only records how each deal turned out.
import type { Inventory, InventoryItem, ItemTemplate } from "./character.ts";
import type { EngineContext } from "./combat.ts";
import { ActionError, type Actor } from "./core.ts";
import { addFromLibrary } from "./ruleset.ts";
import type { DealOutcome, GmPopup, PopupDeal } from "./types.ts";

export const MAX_DEAL_COUNT = 20;
export const MAX_AHN = 9_999_999;

/** What the host lets the engine see and change of players' sheets. */
export interface SheetAccess {
  /** The game's players (user ids). */
  players(): string[];
  /** A player's Ahn and inventory; undefined until they make a character. */
  sheet(uid: string): { ahn: number; inventory: Inventory } | undefined;
  /** An item in the GM's item library (not one waiting for approval). */
  item(templateId: string): ItemTemplate | undefined;
  /** Saves a player's new Ahn and/or inventory items. */
  save(uid: string, change: { ahn?: number; items?: InventoryItem[] }): void;
}

export const OUTCOME_LABELS: Record<DealOutcome, string> = {
  gained: "got it",
  missed: "missed it",
  lost: "lost it",
  kept: "kept it",
  full: "had no free Slot",
  none: "had none to lose",
  nosheet: "has no character",
};

const whole = (n: unknown, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(n) || 0)));

/** What the deal hands out or takes, e.g. "2 Bandage and 50 Ahn". */
export function dealSummary(deal: PopupDeal): string {
  const count = deal.count ?? 1;
  const item = deal.itemId ? `${count > 1 ? `${count} ` : ""}${deal.itemName || "an item"}` : "";
  return [item, deal.ahn ? `${deal.ahn} Ahn` : ""].filter(Boolean).join(" and ");
}

function sheetsOf(ctx: EngineContext | undefined): SheetAccess {
  if (!ctx?.sheets) throw new ActionError("Players' sheets aren't loaded yet.");
  return ctx.sheets;
}

/** Checks a deal the GM is sending: a real item and/or some Ahn, and a roll or price that makes sense. */
export function cleanDeal(deal: PopupDeal, hasRoll: boolean, ctx: EngineContext | undefined): PopupDeal {
  const sheets = sheetsOf(ctx);
  const kind = deal.kind === "cost" ? "cost" : "reward";
  const itemId = deal.itemId ? String(deal.itemId) : "";
  const item = itemId ? sheets.item(itemId) : undefined;
  if (itemId && !item) throw new ActionError("That item isn't in the item library.");
  const ahn = whole(deal.ahn, 0, MAX_AHN);
  if (!item && !ahn) throw new ActionError("Pick an item or an amount of Ahn.");
  const when = deal.when === "roll" || deal.when === "buy" ? deal.when : "now";
  if (when === "roll" && !hasRoll) throw new ActionError("Add a Story Roll for the roll to beat.");
  if (when === "buy" && kind === "cost") throw new ActionError("Only a reward can have a price.");
  const out: PopupDeal = { kind, when };
  if (item) Object.assign(out, { itemId, itemName: item.name || "Item", count: whole(deal.count ?? 1, 1, MAX_DEAL_COUNT) });
  if (ahn) out.ahn = ahn;
  if (when === "roll") out.need = whole(deal.need, 1, 99);
  if (when === "buy") out.price = whole(deal.price, 1, MAX_AHN);
  return out;
}

/** The player's inventory items with `count` more of the item, or why they don't fit. */
function withItems(inv: Inventory, templateId: string, t: ItemTemplate, count: number): { items: InventoryItem[] } | { error: string } {
  let items = inv.items;
  for (let i = 0; i < count; i++) {
    const r = addFromLibrary({ ...inv, items }, templateId, t);
    if ("error" in r) return r;
    items = r.items;
  }
  return { items };
}

/** The player's inventory items with up to `count` of the item taken out, and how many were. */
function withoutItems(items: InventoryItem[], templateId: string, count: number): { items: InventoryItem[]; taken: number } {
  let left = count;
  const out: InventoryItem[] = [];
  for (const i of items) {
    if (left > 0 && i.templateId === templateId) {
      const n = Math.min(left, i.count);
      left -= n;
      if (i.count > n) out.push({ ...i, count: i.count - n });
    } else out.push(i);
  }
  return { items: out, taken: count - left };
}

/**
 * Settles a deal for one player. `success`: they rolled at least the target, so they gain a reward
 * or keep what a cost would take.
 * A reward that doesn't fit still hands out its Ahn; a cost takes what the player has.
 */
export function settleDeal(popup: GmPopup, uid: string, success: boolean, ctx: EngineContext | undefined): DealOutcome {
  const deal = popup.deal!;
  const sheets = sheetsOf(ctx);
  const outcome = settle(sheets, deal, uid, success);
  popup.outcomes = { ...popup.outcomes, [uid]: outcome };
  return outcome;
}

function settle(sheets: SheetAccess, deal: PopupDeal, uid: string, success: boolean): DealOutcome {
  const sheet = sheets.sheet(uid);
  if (!sheet) return "nosheet";
  const count = deal.count ?? 1;
  if (deal.kind === "reward") {
    if (!success) return "missed";
    const t = deal.itemId ? sheets.item(deal.itemId) : undefined;
    const added = t ? withItems(sheet.inventory, deal.itemId!, t, count) : undefined;
    const fits = !added || "items" in added;
    const change: { ahn?: number; items?: InventoryItem[] } = {};
    if (deal.ahn) change.ahn = Math.min(MAX_AHN, sheet.ahn + deal.ahn);
    if (added && "items" in added) change.items = added.items;
    if (change.ahn !== undefined || change.items) sheets.save(uid, change);
    return fits ? "gained" : "full";
  }
  if (success) return "kept";
  const removed = deal.itemId ? withoutItems(sheet.inventory.items, deal.itemId, count) : undefined;
  const change: { ahn?: number; items?: InventoryItem[] } = {};
  if (deal.ahn && sheet.ahn > 0) change.ahn = Math.max(0, sheet.ahn - deal.ahn);
  if (removed?.taken) change.items = removed.items;
  if (change.ahn === undefined && !change.items) return "none";
  sheets.save(uid, change);
  return "lost";
}

/** Settles a deal sent "right away" for each of its players, as soon as the GM sends it. */
export function settleOnSend(popup: GmPopup, ctx: EngineContext | undefined) {
  if (popup.deal?.when !== "now") return;
  // Nothing to roll: a reward is simply given, a cost simply taken.
  const success = popup.deal.kind === "reward";
  for (const uid of popup.to ?? []) settleDeal(popup, uid, success, ctx);
}

/** The players a deal goes to: the ones the GM picked, or every player in the game now (not ones who join later). */
export function dealRecipients(to: string[] | undefined, ctx: EngineContext | undefined): string[] {
  return to?.length ? to : sheetsOf(ctx).players();
}

/** A player pays a popup's price in Ahn and gets its reward. */
export function buyDeal(popup: GmPopup, actor: Actor, ctx: EngineContext | undefined): void {
  const deal = popup.deal;
  if (deal?.when !== "buy") throw new ActionError("That popup isn't selling anything.");
  if (popup.outcomes?.[actor.uid]) throw new ActionError("You've already bought this.");
  const sheets = sheetsOf(ctx);
  const sheet = sheets.sheet(actor.uid);
  if (!sheet) throw new ActionError("Make a character first.");
  const price = deal.price ?? 0;
  if (sheet.ahn < price) throw new ActionError(`You need ${price} Ahn; you have ${sheet.ahn}.`);
  const t = deal.itemId ? sheets.item(deal.itemId) : undefined;
  if (deal.itemId && !t) throw new ActionError("That item is no longer in the item library.");
  const added = t ? withItems(sheet.inventory, deal.itemId!, t, deal.count ?? 1) : undefined;
  if (added && "error" in added) throw new ActionError(`No room: ${added.error}`);
  sheets.save(actor.uid, {
    ahn: Math.min(MAX_AHN, sheet.ahn - price + (deal.ahn ?? 0)),
    ...(added ? { items: added.items } : {}),
  });
  popup.outcomes = { ...popup.outcomes, [actor.uid]: "gained" };
}

/** The GM sets a player's Ahn. */
export function setAhn(uid: unknown, ahn: unknown, ctx: EngineContext | undefined): boolean {
  const sheets = sheetsOf(ctx);
  const id = String(uid ?? "");
  const sheet = sheets.sheet(id);
  if (!sheet) throw new ActionError("That player has no character yet.");
  const next = whole(ahn, 0, MAX_AHN);
  if (next === sheet.ahn) return false;
  sheets.save(id, { ahn: next });
  return true;
}
