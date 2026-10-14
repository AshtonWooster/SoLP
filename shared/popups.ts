// Popups the GM sends to players: any mix of text, an image and a Story Roll prompt. Each goes to
// every player or to the ones the GM picks. A player's phone shows the ones sent to them until they
// close them; the GM screen lists them all, with who closed each and what they rolled. With the Game
// setting "Rewards and costs in popups", a popup can also hand out or take items and Ahn (shared/rewards.ts).
// Once every player it's for has closed it, a popup takes itself down: it leaves every screen but stays
// on the table, marked finished, so the GM keeps its results until they clear it.
import { storyRoll, type EngineContext } from "./combat.ts";
import { ActionError, type Actor } from "./core.ts";
import { newId } from "./id.ts";
import { buyDeal, cleanDeal, dealRecipients, settleDeal, settleOnSend } from "./rewards.ts";
import { PRIMARY_STATS, SECONDARY_STATS } from "./ruleset.ts";
import type { GmPopup, PlayerPopup, TableAction, TableState } from "./types.ts";

/** Popups kept on the table, up and finished; sending more drops the oldest finished one first. */
export const MAX_POPUPS = 30;
export const POPUP_TITLE_MAX = 80;
export const POPUP_TEXT_MAX = 4000;
/** A Story Roll prompt that lets the player pick the Stat. */
export const ANY_STAT = "any";

/** Stats a popup can ask for, by key. */
export const POPUP_STATS: { key: string; label: string }[] = [...PRIMARY_STATS, ...SECONDARY_STATS].map((s) => ({ key: s.key, label: s.label }));

export function statLabel(key: string): string {
  return key === ANY_STAT ? "any Stat" : (POPUP_STATS.find((s) => s.key === key)?.label ?? key);
}

/** Whether a popup is for this player. */
export function popupIsFor(popup: GmPopup, uid: string): boolean {
  return !popup.to?.length || popup.to.includes(uid);
}

/** Whether a popup is still up: not taken down by the GM and not closed by everyone it's for. */
export function popupIsUp(popup: GmPopup): boolean {
  return popup.doneAt === undefined;
}

/** The popups still up, oldest first. */
export function upPopups(table: TableState): GmPopup[] {
  return (table.popups ?? []).filter(popupIsUp);
}

/** Finished popups the GM keeps a record of, newest first. */
export function finishedPopups(table: TableState): GmPopup[] {
  return (table.popups ?? []).filter((p) => !popupIsUp(p)).reverse();
}

/**
 * The players a popup still waits on: the ones it's for who haven't closed it. Undefined when that
 * can't be told: a popup to every player, with no list of the game's players to check.
 * `players`: the game's players now, so one who left isn't waited on.
 */
export function popupWaitingOn(popup: GmPopup, players: string[] | undefined): string[] | undefined {
  const to = popup.to?.length ? (players ? popup.to.filter((uid) => players.includes(uid)) : popup.to) : players;
  return to?.filter((uid) => !popup.closedBy?.includes(uid));
}

/** The popups a player's phone shows: sent to them, still up, not closed yet, oldest first. */
export function popupsFor(table: TableState, uid: string): PlayerPopup[] {
  return (table.popups ?? [])
    .filter((p) => popupIsUp(p) && popupIsFor(p, uid) && !p.closedBy?.includes(uid))
    .map((p) => ({
      id: p.id,
      ...(p.title ? { title: p.title } : {}),
      ...(p.text ? { text: p.text } : {}),
      ...(p.image ? { image: p.image } : {}),
      ...(p.roll ? { roll: { stat: p.roll.stat } } : {}),
      ...(p.rolls?.[uid] !== undefined ? { rolled: p.rolls[uid] } : {}),
      ...(p.deal ? { deal: { ...p.deal } } : {}),
      ...(p.outcomes?.[uid] ? { outcome: p.outcomes[uid] } : {}),
    }));
}

/** A popup worth sending: it says or shows something, asks for a roll, or hands out or takes something. */
function cleanPopup(action: Extract<TableAction, { type: "sendPopup" }>, ctx?: EngineContext): GmPopup {
  const title = String(action.title ?? "").trim().slice(0, POPUP_TITLE_MAX);
  const text = String(action.text ?? "").trim().slice(0, POPUP_TEXT_MAX);
  const image = typeof action.image === "string" && /^https?:\/\//.test(action.image) ? action.image.slice(0, 2000) : "";
  const stat = action.roll ? String(action.roll.stat ?? "").toLowerCase() : "";
  if (stat && stat !== ANY_STAT && !POPUP_STATS.some((s) => s.key === stat)) throw new ActionError("Pick a Stat for the Story Roll.");
  const deal = action.deal ? cleanDeal(action.deal, !!stat, ctx) : undefined;
  if (!title && !text && !image && !stat && !deal) throw new ActionError("Add some text, an image or a Story Roll first.");
  let to = [...new Set((Array.isArray(action.to) ? action.to : []).map(String).filter(Boolean))].slice(0, 50);
  // A deal goes to the players there now, so one who joins later doesn't get (or pay for) it.
  if (deal) to = dealRecipients(to, ctx).slice(0, 50);
  return {
    id: String(action.id || newId()).slice(0, 80),
    ...(title ? { title } : {}),
    ...(text ? { text } : {}),
    ...(image ? { image } : {}),
    ...(stat ? { roll: { stat } } : {}),
    ...(deal ? { deal } : {}),
    ...(to.length ? { to } : {}),
    sentAt: Date.now(),
  };
}

/** A popup that's still up. */
function find(table: TableState, popupId: unknown): GmPopup {
  const p = table.popups?.find((x) => x.id === String(popupId));
  if (!p || !popupIsUp(p)) throw new ActionError("That popup was taken down.");
  return p;
}

/** Keeps at most MAX_POPUPS, dropping the oldest finished ones first, then the oldest still up. */
function trim(list: GmPopup[]): GmPopup[] {
  let extra = list.length - MAX_POPUPS;
  if (extra <= 0) return list;
  const out = list.filter((p) => popupIsUp(p) || extra-- <= 0);
  return out.slice(-MAX_POPUPS);
}

/** The GM shows players a popup. */
export function sendPopup(table: TableState, action: Extract<TableAction, { type: "sendPopup" }>, ctx?: EngineContext): GmPopup {
  const popup = cleanPopup(action, ctx);
  settleOnSend(popup, ctx);
  const list = (table.popups ?? []).filter((p) => p.id !== popup.id);
  list.push(popup);
  table.popups = trim(list);
  return popup;
}

/** The GM takes a popup down from every screen. Its results stay in the GM's finished list. */
export function removePopup(table: TableState, popupId: unknown): boolean {
  const p = table.popups?.find((x) => x.id === String(popupId));
  if (!p || !popupIsUp(p)) return false;
  p.doneAt = Date.now();
  p.takenDown = true;
  return true;
}

/** The GM clears one finished popup from their list, or every finished one. Popups still up stay. */
export function clearPopups(table: TableState, popupId?: unknown): boolean {
  const before = table.popups?.length ?? 0;
  const id = popupId === undefined ? undefined : String(popupId);
  table.popups = (table.popups ?? []).filter((p) => popupIsUp(p) || (id !== undefined && p.id !== id));
  if (!table.popups.length) delete table.popups;
  return (table.popups?.length ?? 0) !== before;
}

/** Takes a popup down once no one it's for still has it open. */
function finishIfDone(p: GmPopup, ctx?: EngineContext) {
  if (popupWaitingOn(p, ctx?.sheets?.players())?.length === 0) p.doneAt = Date.now();
}

/** A player closes a popup sent to them. The last one to close it takes it down. */
export function closePopup(table: TableState, actor: Actor, popupId: unknown, ctx?: EngineContext): boolean {
  // Closing twice (say, from a second phone) does nothing, even once the popup has come down.
  if (table.popups?.find((x) => x.id === String(popupId))?.closedBy?.includes(actor.uid)) return false;
  const p = find(table, popupId);
  if (!popupIsFor(p, actor.uid)) throw new ActionError("That popup isn't for you.");
  p.closedBy = [...(p.closedBy ?? []), actor.uid];
  finishIfDone(p, ctx);
  return true;
}

/** A player makes the Story Roll a popup asks for, once. The result goes in the log like any Story Roll. */
export function popupRoll(table: TableState, actor: Actor, popupId: unknown, chosen: unknown, ctx?: EngineContext): number {
  const p = find(table, popupId);
  if (!popupIsFor(p, actor.uid)) throw new ActionError("That popup isn't for you.");
  if (!p.roll) throw new ActionError("That popup doesn't ask for a roll.");
  if (p.rolls?.[actor.uid] !== undefined) throw new ActionError("You've already rolled for this.");
  const stat = p.roll.stat === ANY_STAT ? String(chosen ?? "").toLowerCase() : p.roll.stat;
  if (!POPUP_STATS.some((s) => s.key === stat)) throw new ActionError("Pick a Stat to roll.");
  const token = Object.values(table.tokens).find((t) => t.ownerId === actor.uid);
  if (!token) throw new ActionError("You need a token on the table to roll.");
  const total = storyRoll(table, actor, token, stat, ctx);
  p.rolls = { ...p.rolls, [actor.uid]: total };
  if (p.deal?.when === "roll") settleDeal(p, actor.uid, total >= (p.deal.need ?? 0), ctx);
  return total;
}

/** A player pays a popup's price in Ahn for its reward. */
export function popupBuy(table: TableState, actor: Actor, popupId: unknown, ctx?: EngineContext): void {
  const p = find(table, popupId);
  if (!popupIsFor(p, actor.uid)) throw new ActionError("That popup isn't for you.");
  buyDeal(p, actor, ctx);
}
