// Rewards and costs in GM popups: items and Ahn handed out or taken, right away, on a Story Roll or
// for a price. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Inventory, InventoryItem, ItemTemplate } from "../shared/character.ts";
import { applyAction, type Actor, type EngineContext } from "../shared/engine.ts";
import { popupsFor } from "../shared/popups.ts";
import { dealSummary, type SheetAccess } from "../shared/rewards.ts";
import { tableForPlayers } from "../shared/secrets.ts";
import { popupRewardsOn, type TableState, type Token } from "../shared/types.ts";

const gm: Actor = { uid: "gm", role: "gm", displayName: "GM" };
const ann: Actor = { uid: "ann", role: "player", displayName: "Ann" };
const bo: Actor = { uid: "bo", role: "player", displayName: "Bo" };
const resources = { hp: 10, maxHp: 10, stagger: 5, maxStagger: 5, light: 3, maxLight: 3, sanity: 0, maxSanity: 15 };
const token = (id: string, ownerId: string): Token => ({ id, name: id, side: "player", x: 0, y: 0, color: "#fff", resources, ownerId });

const tmpl = (name: string, extra: Partial<ItemTemplate> = {}): ItemTemplate => ({ name, description: "", kind: "item", stacking: false, maxStack: 1, ...extra });
const library: Record<string, ItemTemplate> = {
  sword: tmpl("Sword"),
  ammo: tmpl("Ammo", { stacking: true, maxStack: 10 }),
  draft: tmpl("Draft", { pending: true }),
};

/** A host stand-in: players' sheets in memory, saved the way the host saves them. */
function world(opts: { rewards?: boolean; slots?: number; players?: string[] } = {}) {
  const sheets: Record<string, { ahn: number; inventory: Inventory }> = {
    ann: { ahn: 100, inventory: { slotCount: opts.slots ?? 9, items: [], trinket: null } },
    bo: { ahn: 5, inventory: { slotCount: opts.slots ?? 9, items: [], trinket: null } },
  };
  const saves: { uid: string; ahn?: number; items?: InventoryItem[] }[] = [];
  const access: SheetAccess = {
    players: () => opts.players ?? ["ann", "bo"],
    sheet: (uid) => sheets[uid],
    item: (id) => (library[id]?.pending ? undefined : library[id]),
    save: (uid, change) => {
      saves.push({ uid, ...change });
      if (change.ahn !== undefined) sheets[uid].ahn = change.ahn;
      if (change.items) sheets[uid].inventory.items = change.items;
    },
  };
  const ctx: EngineContext = {
    loadout: () => ({ pages: {}, deck: [], aux: [], stats: { insight: 0 } }),
    popupRewards: () => opts.rewards ?? true,
    sheets: access,
  };
  const table: TableState = { map: { name: "m", width: 8, height: 4 }, tokens: { annie: token("annie", "ann"), bob: token("bob", "bo") }, log: [] };
  const held = (uid: string, id: string) => sheets[uid].inventory.items.filter((i) => i.templateId === id).reduce((n, i) => n + i.count, 0);
  return { sheets, saves, ctx, table, held };
}

test("the setting is off unless the GM turns it on, and a deal needs it", () => {
  assert.equal(popupRewardsOn(undefined), false);
  assert.equal(popupRewardsOn({ settings: {} } as never), false);
  assert.equal(popupRewardsOn({ settings: { popupRewards: true } } as never), true);
  const w = world({ rewards: false });
  assert.throws(
    () => applyAction(w.table, { type: "sendPopup", text: "Loot", deal: { kind: "reward", itemId: "sword", when: "now" } }, gm, w.ctx),
    /Game settings/,
  );
  assert.throws(() => applyAction(w.table, { type: "setAhn", uid: "ann", ahn: 5 }, gm, w.ctx), /Game settings/);
  // Plain popups work just as before.
  assert.ok(applyAction(w.table, { type: "sendPopup", text: "Hi" }, gm, w.ctx));
  assert.deepEqual(w.saves, []);
});

test("a reward sent right away reaches every player's sheet at once", () => {
  const w = world();
  applyAction(w.table, { type: "sendPopup", id: "p", text: "Spoils", deal: { kind: "reward", itemId: "ammo", count: 3, ahn: 20, when: "now" } }, gm, w.ctx);
  assert.equal(w.held("ann", "ammo"), 3);
  assert.equal(w.held("bo", "ammo"), 3);
  assert.equal(w.sheets.ann.ahn, 120);
  assert.equal(w.sheets.bo.ahn, 25);
  assert.deepEqual(w.table.popups![0].outcomes, { ann: "gained", bo: "gained" });
  // It went to the players there now, not to ones who join later.
  assert.deepEqual(w.table.popups![0].to, ["ann", "bo"]);
  assert.deepEqual(popupsFor(w.table, "cy"), []);
  assert.equal(popupsFor(w.table, "ann")[0].outcome, "gained");
  assert.equal(popupsFor(w.table, "ann")[0].deal?.itemName, "Ammo");
  // Nothing about it reaches the shared table.
  assert.equal(tableForPlayers(w.table).popups, undefined);
});

test("a reward to picked players reaches only them", () => {
  const w = world();
  applyAction(w.table, { type: "sendPopup", deal: { kind: "reward", ahn: 50, when: "now" }, to: ["bo"] }, gm, w.ctx);
  assert.equal(w.sheets.ann.ahn, 100);
  assert.equal(w.sheets.bo.ahn, 55);
});

test("a reward with no free Slot still hands out its Ahn", () => {
  const w = world({ slots: 0 });
  applyAction(w.table, { type: "sendPopup", deal: { kind: "reward", itemId: "sword", ahn: 10, when: "now" }, to: ["ann"] }, gm, w.ctx);
  assert.equal(w.held("ann", "sword"), 0);
  assert.equal(w.sheets.ann.ahn, 110);
  assert.equal(w.table.popups![0].outcomes?.ann, "full");
});

test("a cost sent right away takes the item and Ahn, never below zero", () => {
  const w = world();
  w.sheets.ann.inventory.items = [{ id: "i1", templateId: "ammo", name: "Ammo", description: "", kind: "item", stacking: true, count: 4, maxStack: 10 }];
  applyAction(w.table, { type: "sendPopup", deal: { kind: "cost", itemId: "ammo", count: 3, ahn: 10, when: "now" } }, gm, w.ctx);
  assert.equal(w.held("ann", "ammo"), 1);
  assert.equal(w.sheets.ann.ahn, 90);
  assert.equal(w.sheets.bo.ahn, 0);
  assert.deepEqual(w.table.popups![0].outcomes, { ann: "lost", bo: "lost" });
  // Someone with nothing to lose loses nothing.
  w.sheets.bo.ahn = 0;
  applyAction(w.table, { type: "sendPopup", deal: { kind: "cost", itemId: "sword", ahn: 5, when: "now" }, to: ["bo"] }, gm, w.ctx);
  assert.equal(w.table.popups![1].outcomes?.bo, "none");
});

test("a deal must name a library item or some Ahn, and a roll target needs a Story Roll", () => {
  const w = world();
  const send = (deal: object, roll?: { stat: string }) => applyAction(w.table, { type: "sendPopup", text: "x", roll, deal: deal as never }, gm, w.ctx);
  assert.throws(() => send({ kind: "reward", when: "now" }), /item or an amount of Ahn/);
  assert.throws(() => send({ kind: "reward", itemId: "nope", when: "now" }), /isn't in the item library/);
  assert.throws(() => send({ kind: "reward", itemId: "draft", when: "now" }), /isn't in the item library/);
  assert.throws(() => send({ kind: "reward", itemId: "sword", when: "roll", need: 8 }), /Add a Story Roll/);
  assert.throws(() => send({ kind: "cost", itemId: "sword", when: "buy", price: 8 }), /Only a reward/);
  assert.throws(() => applyAction(w.table, { type: "sendPopup", deal: { kind: "reward", ahn: 1, when: "now" } }, ann, w.ctx), /GM only/);
  assert.deepEqual(w.saves, []);
});

test("a reward on a roll goes to players who roll at least the target", () => {
  for (const [need, expect] of [[1, "gained"], [99, "missed"]] as const) {
    const w = world();
    applyAction(w.table, { type: "sendPopup", id: "p", roll: { stat: "insight" }, deal: { kind: "reward", itemId: "sword", when: "roll", need } }, gm, w.ctx);
    assert.deepEqual(w.saves, [], "nothing is handed out until they roll");
    assert.equal(popupsFor(w.table, "ann")[0].outcome, undefined);
    applyAction(w.table, { type: "popupRoll", popupId: "p" }, ann, w.ctx);
    assert.equal(w.table.popups![0].outcomes?.ann, expect);
    assert.equal(w.held("ann", "sword"), expect === "gained" ? 1 : 0);
    assert.equal(w.held("bo", "sword"), 0);
  }
});

test("a cost on a roll is lost below the target and kept at or above it", () => {
  for (const [need, expect] of [[1, "kept"], [99, "lost"]] as const) {
    const w = world();
    w.sheets.ann.inventory.items = [{ id: "s", templateId: "sword", name: "Sword", description: "", kind: "item", stacking: false, count: 1, maxStack: 1 }];
    applyAction(w.table, { type: "sendPopup", id: "p", roll: { stat: "insight" }, deal: { kind: "cost", itemId: "sword", when: "roll", need } }, gm, w.ctx);
    applyAction(w.table, { type: "popupRoll", popupId: "p" }, ann, w.ctx);
    assert.equal(w.table.popups![0].outcomes?.ann, expect);
    assert.equal(w.held("ann", "sword"), expect === "kept" ? 1 : 0);
  }
});

test("a player buys a reward for its price, once, if they can pay and have room", () => {
  const w = world();
  applyAction(w.table, { type: "sendPopup", id: "shop", text: "A blade for sale", deal: { kind: "reward", itemId: "sword", when: "buy", price: 30 } }, gm, w.ctx);
  assert.deepEqual(w.saves, []);
  assert.throws(() => applyAction(w.table, { type: "popupBuy", popupId: "shop" }, bo, w.ctx), /need 30 Ahn; you have 5/);
  assert.throws(() => applyAction(w.table, { type: "popupBuy", popupId: "shop" }, gm, w.ctx), /Players buy/);
  assert.ok(applyAction(w.table, { type: "popupBuy", popupId: "shop" }, ann, w.ctx));
  assert.equal(w.sheets.ann.ahn, 70);
  assert.equal(w.held("ann", "sword"), 1);
  assert.equal(popupsFor(w.table, "ann")[0].outcome, "gained");
  assert.throws(() => applyAction(w.table, { type: "popupBuy", popupId: "shop" }, ann, w.ctx), /already bought/);
  assert.equal(w.sheets.ann.ahn, 70);
});

test("a purchase with no free Slot costs nothing", () => {
  const w = world({ slots: 0 });
  applyAction(w.table, { type: "sendPopup", id: "shop", deal: { kind: "reward", itemId: "sword", when: "buy", price: 30 } }, gm, w.ctx);
  assert.throws(() => applyAction(w.table, { type: "popupBuy", popupId: "shop" }, ann, w.ctx), /No room/);
  assert.equal(w.sheets.ann.ahn, 100);
});

test("only players a shop popup is for can buy, and only from one that sells", () => {
  const w = world();
  applyAction(w.table, { type: "sendPopup", id: "shop", deal: { kind: "reward", ahn: 5, when: "buy", price: 1 }, to: ["ann"] }, gm, w.ctx);
  applyAction(w.table, { type: "sendPopup", id: "note", text: "Just text" }, gm, w.ctx);
  assert.throws(() => applyAction(w.table, { type: "popupBuy", popupId: "shop" }, bo, w.ctx), /isn't for you/);
  assert.throws(() => applyAction(w.table, { type: "popupBuy", popupId: "note" }, ann, w.ctx), /isn't selling/);
});

test("players without a character get nothing and are marked so", () => {
  const w = world({ players: ["ann", "cy"] });
  applyAction(w.table, { type: "sendPopup", deal: { kind: "reward", ahn: 5, when: "now" } }, gm, w.ctx);
  assert.deepEqual(w.table.popups![0].outcomes, { ann: "gained", cy: "nosheet" });
});

test("the GM sets a player's Ahn; the table itself doesn't change", () => {
  const w = world();
  assert.equal(applyAction(w.table, { type: "setAhn", uid: "bo", ahn: 42.4 }, gm, w.ctx), false);
  assert.equal(w.sheets.bo.ahn, 42);
  applyAction(w.table, { type: "setAhn", uid: "bo", ahn: -5 }, gm, w.ctx);
  assert.equal(w.sheets.bo.ahn, 0);
  assert.throws(() => applyAction(w.table, { type: "setAhn", uid: "bo", ahn: 5 }, ann, w.ctx), /GM only/);
  assert.throws(() => applyAction(w.table, { type: "setAhn", uid: "cy", ahn: 5 }, gm, w.ctx), /no character/);
});

test("a deal reads as what it hands out", () => {
  assert.equal(dealSummary({ kind: "reward", itemId: "a", itemName: "Ammo", count: 3, ahn: 20, when: "now" }), "3 Ammo and 20 Ahn");
  assert.equal(dealSummary({ kind: "cost", itemId: "s", itemName: "Sword", when: "now" }), "Sword");
});
