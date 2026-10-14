// Ranged Pages: Weapon Ranges, Melee vs Ranged at the end of a clash, Partial and Full Cover, and
// Ammo. Run with `npm run test:engine`. Dice here have 1 side, so Final Power = 1 + Base Power.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Character, Dice, DiceKind, Inventory, InventoryItem, ItemTemplate, Page, PageType, Weapon } from "../shared/character.ts";
import { applyAction, validTargets, type Actor, type EngineContext, type Loadout } from "../shared/engine.ts";
import { cleanTemplate, isAmmo, MAX_WEAPON_RANGE, pageRange, spendOne, WEAPON_RANGE, weaponRange, withWeaponRanges } from "../shared/ruleset.ts";
import { rangedPagesUseAmmo, type GameDoc, type TableAction, type TableState, type Token } from "../shared/types.ts";

const gm: Actor = { uid: "gm", role: "gm", displayName: "GM" };
const p1: Actor = { uid: "p1", role: "player", displayName: "P1" };
const p2: Actor = { uid: "p2", role: "player", displayName: "P2" };

let n = 0;
const die = (kind: DiceKind, fp: number, counter = false): Dice => ({ id: `d${n++}`, kind, counter, sides: 1, basePower: fp - 1 });
const page = (id: string, type: PageType, dice: Dice[], range?: number): Page => ({ id, name: id, kind: "basic", cost: 0, type, dice, effect: "", ...(range !== undefined ? { range } : {}) });

function token(id: string, side: Token["side"], x: number, y: number, extra: Partial<Token> = {}): Token {
  return {
    id, name: id, side, x, y, color: "#fff",
    resources: { hp: 30, maxHp: 30, stagger: 20, maxStagger: 20, light: 5, maxLight: 5, sanity: 0, maxSanity: 15 },
    ...extra,
  };
}

const item = (id: string, extra: Partial<InventoryItem> = {}): InventoryItem => ({ id, name: id, description: "", kind: "item", stacking: true, count: 1, maxStack: 20, ...extra });

/** Roland (player, always first) next to a Rat (enemy), with Roland's inventory for Ammo. */
function setup(playerPages: Page[], enemyPages: Page[] = [], opts: { ammo?: boolean; items?: InventoryItem[]; library?: Record<string, ItemTemplate> } = {}) {
  const table: TableState = {
    map: { name: "m", width: 16, height: 10 },
    tokens: {
      roland: token("roland", "player", 2, 2, { ownerId: "p1", justice: 100 }),
      rat: token("rat", "enemy", 3, 2, { justice: -100, pages: enemyPages }),
    },
    log: [],
  };
  const loadout: Loadout = { pages: Object.fromEntries(playerPages.map((p) => [p.id, p])), deck: playerPages.flatMap((p) => Array(12 / playerPages.length).fill(p.id)), aux: [] };
  const sheet: { ahn: number; inventory: Inventory } = { ahn: 0, inventory: { slotCount: 9, items: opts.items ?? [], trinket: null } };
  const ctx: EngineContext = {
    loadout: (id) => (id === "roland" ? loadout : undefined),
    rangedAmmo: () => !!opts.ammo,
    sheets: {
      players: () => ["p1"],
      sheet: (uid) => (uid === "p1" ? sheet : undefined),
      item: (id) => opts.library?.[id],
      save: (_uid, change) => void (change.items && (sheet.inventory.items = change.items)),
    },
  };
  const act = (a: TableAction, who: Actor = p1) => applyAction(table, a, who, ctx);
  act({ type: "startCombat", tokenIds: ["roland", "rat"] }, gm);
  return { table, act, sheet, c: () => table.combat!, hp: (id: string) => table.tokens[id].resources.hp };
}
type S = ReturnType<typeof setup>;

function play(s: S, pageId: string, targets: string[], extra: Partial<Extract<TableAction, { type: "slot" }>> = {}) {
  const card = s.c().decks.roland.hand.find((x) => x.pageId === pageId);
  assert.ok(card, `${pageId} in hand`);
  s.act({ type: "aim", source: "hand", cardId: card.id });
  s.act({ type: "slot", targets, ...extra });
}

function enemyPlay(s: S, pageId: string, targets: string[], extra: Partial<Extract<TableAction, { type: "slot" }>> = {}) {
  const card = s.c().decks.rat.hand.find((x) => x.pageId === pageId);
  assert.ok(card, `${pageId} in the Rat's hand`);
  s.act({ type: "aim", source: "hand", cardId: card.id }, gm);
  s.act({ type: "slot", targets, ...extra }, gm);
}

const endTurn = (s: S, who: Actor = gm) => s.act({ type: "endTurn" }, who);
const slotOf = (s: S, owner: string) => s.c().slots.find((x) => x.ownerId === owner)!;

// ---- Weapon Ranges ----

test("a Weapon's Melee and Ranged ranges: what was set (clamped), else the defaults", () => {
  assert.equal(weaponRange({}, "melee"), WEAPON_RANGE.melee);
  assert.equal(weaponRange({}, "ranged"), WEAPON_RANGE.ranged);
  assert.equal(weaponRange({ meleeRange: 2, rangedRange: 12 }, "melee"), 2);
  assert.equal(weaponRange({ meleeRange: 2, rangedRange: 12 }, "ranged"), 12);
  assert.equal(weaponRange({ rangedRange: 9999 }, "ranged"), MAX_WEAPON_RANGE);
  assert.equal(weaponRange({ meleeRange: -3 }, "melee"), 0);
  assert.equal(pageRange(page("x", "ranged", [])), WEAPON_RANGE.ranged);
  assert.equal(pageRange(page("x", "ranged", [], 9)), 9);
});

test("each Page gets its Weapon's range for its type; Armor, other types and unset ranges keep the defaults", () => {
  const bash = page("bash", "melee", []);
  const shot = page("shot", "ranged", []);
  const heal = page("heal", "instant", []);
  const gun: Weapon = { id: "gun", name: "Gun", description: "", passives: [], hands: 2, rangedRange: 10, pages: [bash, shot, heal] };
  const knife: Weapon = { id: "knife", name: "Knife", description: "", passives: [], hands: 1, meleeRange: 2, pages: [page("stab", "melee", [])] };
  const armorPage = page("guard", "melee", []);
  const c = { weapons: [gun, knife] } as Pick<Character, "weapons">;
  const out = withWeaponRanges(c, [bash, shot, heal, knife.pages[0], armorPage]);
  assert.deepEqual(
    out.map((p) => p.range),
    [undefined, 10, undefined, 2, undefined],
  );
  assert.equal(shot.range, undefined, "the sheet's own Pages are left alone");
  // A ranged weapon with Melee Pages too: both ranges.
  const both = withWeaponRanges({ weapons: [{ ...gun, meleeRange: 3 }] }, [bash, shot]);
  assert.deepEqual(both.map((p) => p.range), [3, 10]);
  // The Ranged Page also carries the Melee range, for when it's fired without Ammo.
  assert.deepEqual(both.map((p) => p.meleeRange), [undefined, 3]);
  assert.equal(out[1].meleeRange, undefined, "no Melee range set: the default applies");
});

test("targets are picked by the Page's own Weapon Range", () => {
  const s = setup([page("reach", "melee", [die("slash", 3)], 4), page("short", "melee", [die("slash", 3)])]);
  s.table.tokens.rat.x = 6; // 4 tiles away
  const roland = s.table.tokens.roland;
  assert.deepEqual(validTargets(s.table, roland, s.c().pages.reach).map((t) => t.id), ["rat"]);
  assert.deepEqual(validTargets(s.table, roland, s.c().pages.short).map((t) => t.id), []);
  play(s, "reach", ["rat"]);
  assert.equal(s.c().slots.length, 1);
});

// ---- Melee vs Ranged ----

test("Melee vs Ranged: winning melee dice recycle, and if the Ranged user is out of the Melee range its leftovers become Counter Dice", () => {
  for (const out of [false, true]) {
    const s = setup([page("swing", "melee", [die("slash", 9), die("slash", 9)])], [page("shot", "ranged", [die("pierce", 3)])]);
    endTurn(s, p1);
    enemyPlay(s, "shot", ["roland"]);
    endTurn(s);
    play(s, "swing", ["rat"]); // Clash with the Shot.
    if (out) s.table.tokens.rat.x = 6; // The Rat backs off out of melee range before it resolves.
    endTurn(s, p1);
    // Slash 9 beats Pierce 3: no damage, recycled to the bottom. Then the Shot is spent.
    assert.equal(s.hp("roland"), 30);
    if (out) {
      assert.equal(s.hp("rat"), 30, "nothing reaches the Rat");
      assert.deepEqual(s.c().counters.roland.map((x) => x.die.kind), ["slash", "slash"]);
      assert.ok(s.table.log.some((l) => /out of roland's range: roland's 2 remaining dice become Counter Dice/.test(l)));
    } else {
      assert.equal(s.hp("rat"), 30 - 9 - 9, "both leftover Slash dice hit");
      assert.equal((s.c().counters.roland ?? []).length, 0);
    }
  }
});

test("the out-of-range check uses the Melee Page's own Weapon Range", () => {
  const s = setup([page("spear", "melee", [die("slash", 9), die("slash", 9)], 5)], [page("shot", "ranged", [die("pierce", 3)])]);
  endTurn(s, p1);
  enemyPlay(s, "shot", ["roland"]);
  endTurn(s);
  play(s, "spear", ["rat"]);
  s.table.tokens.rat.x = 6; // 4 tiles: past the default melee range, inside the spear's 5.
  endTurn(s, p1);
  assert.equal(s.hp("rat"), 30 - 18);
});

// ---- Cover ----

test("only the GM marks Cover, and only on a Ranged Page", () => {
  const s = setup([page("shot", "ranged", [die("pierce", 5)]), page("swing", "melee", [die("slash", 5)])]);
  play(s, "shot", ["rat"]);
  const id = slotOf(s, "roland").id;
  assert.throws(() => s.act({ type: "setCover", slotId: id, cover: "partial" }), /Only the GM/);
  s.act({ type: "setCover", slotId: id, cover: "partial" }, gm);
  assert.equal(slotOf(s, "roland").cover, "partial");
  s.act({ type: "setCover", slotId: id, cover: null }, gm);
  assert.equal(slotOf(s, "roland").cover, undefined);
  s.c().slots = [];
  play(s, "swing", ["rat"]);
  assert.throws(() => s.act({ type: "setCover", slotId: slotOf(s, "roland").id, cover: "partial" }, gm), /Only Ranged Pages/);
});

test("Partial Cover: the Ranged Page's dice get Final Power - 2, never below 1", () => {
  const s = setup([page("volley", "ranged", [die("pierce", 5), die("pierce", 2), die("pierce", 1)])]);
  play(s, "volley", ["rat"]);
  s.act({ type: "setCover", slotId: slotOf(s, "roland").id, cover: "partial" }, gm);
  endTurn(s, p1);
  endTurn(s);
  // 5 → 3, 2 → 1, 1 stays 1.
  assert.equal(s.hp("rat"), 30 - 3 - 1 - 1);
  assert.ok(s.table.log.some((l) => l.includes("Partial Cover: 5 → 3")));
});

test("Partial Cover in a clash weakens only the Ranged Page's dice", () => {
  const s = setup([page("shot", "ranged", [die("pierce", 5)])], [page("bite", "melee", [die("pierce", 4)])]);
  play(s, "shot", ["rat"]);
  s.act({ type: "setCover", slotId: slotOf(s, "roland").id, cover: "partial" }, gm);
  endTurn(s, p1);
  enemyPlay(s, "bite", ["roland"]); // Clashes with the Shot.
  endTurn(s);
  endTurn(s, p1); // Roland's turn: Pierce 5 - 2 = 3 loses to Pierce 4.
  assert.equal(s.hp("roland"), 26);
  assert.equal(s.hp("rat"), 30);
});

test("Full Cover, hold fire: the Page is Negated; Defensive Dice become Counter Dice and its Counter Dice stay", () => {
  const s = setup([], [page("shot", "ranged", [die("pierce", 3), die("block", 4), die("evade", 2, true)])]);
  endTurn(s, p1);
  enemyPlay(s, "shot", ["roland"]);
  assert.equal(s.c().counters.rat.length, 1, "its Counter Die was stored when slotted");
  const id = slotOf(s, "rat").id;
  s.act({ type: "setCover", slotId: id, cover: "full" }, gm);
  assert.throws(() => s.act({ type: "coverChoice", slotId: id, fire: false }), /Only the Page's owner/);
  s.act({ type: "coverChoice", slotId: id, fire: false }, gm);
  assert.equal(s.c().slots.length, 0);
  assert.deepEqual(s.c().counters.rat.map((x) => x.die.kind), ["evade", "block"]);
  assert.equal(s.c().decks.rat.discard.length, 1, "the Page goes to the discard pile");
  endTurn(s);
  endTurn(s, p1);
  assert.equal(s.hp("roland"), 30, "the Pierce never fired");
});

test("Full Cover, fire now: the attack resolves at once, out of turn, without the Cover penalty", () => {
  const s = setup([page("shot", "ranged", [die("pierce", 5)])]);
  play(s, "shot", ["rat"]);
  endTurn(s, p1); // The Rat's turn.
  const id = slotOf(s, "roland").id;
  s.act({ type: "setCover", slotId: id, cover: "full" }, gm);
  assert.throws(() => s.act({ type: "coverChoice", slotId: id, fire: true }, p2), /Only the Page's owner/);
  s.act({ type: "coverChoice", slotId: id, fire: true });
  assert.equal(s.hp("rat"), 25);
  assert.equal(s.c().slots.length, 0);
  assert.throws(() => s.act({ type: "coverChoice", slotId: id, fire: true }), /no longer slotted/);
});

test("Full Cover, fire now in a clash: both Pages resolve right away", () => {
  const s = setup([page("shot", "ranged", [die("pierce", 6)])], [page("bite", "melee", [die("pierce", 3)])]);
  play(s, "shot", ["rat"]);
  endTurn(s, p1);
  enemyPlay(s, "bite", ["roland"]); // Clash.
  s.act({ type: "setCover", slotId: slotOf(s, "roland").id, cover: "full" }, gm);
  s.act({ type: "coverChoice", slotId: slotOf(s, "roland").id, fire: true });
  assert.equal(s.hp("rat"), 24);
  assert.equal(s.c().slots.length, 0);
});

test("Full Cover with no answer: the Page holds fire when it would resolve, and the Page it clashed with goes One-Sided", () => {
  const s = setup([page("shot", "ranged", [die("pierce", 6), die("block", 3)])], [page("bite", "melee", [die("pierce", 3)])]);
  play(s, "shot", ["rat"]);
  endTurn(s, p1);
  enemyPlay(s, "bite", ["roland"]); // Clash.
  s.act({ type: "setCover", slotId: slotOf(s, "roland").id, cover: "full" }, gm);
  endTurn(s); // Roland's turn: the Shot holds fire; the Bite now waits for the Rat's turn.
  assert.equal(s.hp("rat"), 30);
  assert.ok(s.table.log.some((l) => l.includes("roland holds fire")));
  assert.equal(slotOf(s, "rat").clashWith, undefined);
  assert.ok(s.table.log.some((l) => l.includes("1 Defensive Die becomes a Counter Die")));
  // Counter Dice made at his own Resolve phase are gone at the end of that Upkeep, like any leftovers.
  assert.equal((s.c().counters.roland ?? []).length, 0);
  endTurn(s, p1); // The Rat's Bite hits One-Sided.
  assert.equal(s.hp("roland"), 27);
});

test("the Page it clashed with resolving first also makes a Full Cover Page hold fire", () => {
  const s = setup([page("bite", "melee", [die("pierce", 3)])], [page("shot", "ranged", [die("pierce", 6)])]);
  endTurn(s, p1);
  enemyPlay(s, "shot", ["roland"]);
  endTurn(s);
  play(s, "bite", ["rat"]); // Clash with the Shot.
  s.act({ type: "setCover", slotId: slotOf(s, "rat").id, cover: "full" }, gm);
  endTurn(s, p1); // The Rat's turn: its Shot is still waiting on an answer, so it holds fire.
  assert.equal(s.hp("roland"), 30);
  assert.equal(s.c().slots.length, 1, "Roland's Bite waits for his turn");
});

// ---- Ammo ----

test("Ranged Pages use Ammo is off unless the GM turns it on", () => {
  const game = (settings?: GameDoc["settings"]) => ({ name: "g", gmId: "gm", members: {}, settings }) as unknown as GameDoc;
  assert.equal(rangedPagesUseAmmo(undefined), false);
  assert.equal(rangedPagesUseAmmo(game()), false);
  assert.equal(rangedPagesUseAmmo(game({ rangedAmmo: false })), false);
  assert.equal(rangedPagesUseAmmo(game({ rangedAmmo: true })), true);
});

test("with the setting off, Ranged Pages fire with no Ammo and spend none", () => {
  const s = setup([page("shot", "ranged", [die("pierce", 3)])], [], { items: [item("bullets", { ammo: true, count: 3 })] });
  play(s, "shot", ["rat"]);
  assert.equal(s.c().slots.length, 1);
  assert.equal(s.sheet.inventory.items[0].count, 3);
  assert.equal(slotOf(s, "roland").ammo, undefined);
});

test("with the setting on, a Ranged Page spends one of the Ammo stack the player picks", () => {
  const s = setup([page("shot", "ranged", [die("pierce", 3)]), page("swing", "melee", [die("slash", 3)])], [], {
    ammo: true,
    items: [item("rope"), item("bullets", { ammo: true, count: 3 }), item("slugs", { ammo: true, count: 1 })],
  });
  assert.throws(() => play(s, "shot", ["rat"], { ammo: "rope" }), /isn't in the inventory/);
  play(s, "shot", ["rat"], { ammo: "slugs" });
  assert.equal(slotOf(s, "roland").ammo, "slugs");
  assert.deepEqual(s.sheet.inventory.items.map((i) => `${i.id}:${i.count}`), ["rope:1", "bullets:3"], "the last slug leaves its Slot");
  assert.ok(s.table.log.some((l) => l.includes("loads slugs (the last one)")));
  // Melee Pages need none.
  s.c().slots = [];
  play(s, "swing", ["rat"]);
  assert.equal(s.sheet.inventory.items.length, 2);
});

test("an inventory item counts as Ammo when the GM marks its library item as Ammo; the GM's slot uses the first", () => {
  const library: Record<string, ItemTemplate> = { lib: { name: "Arrows", description: "", kind: "item", stacking: true, maxStack: 20, ammo: true } };
  const s = setup([page("shot", "ranged", [die("pierce", 3)])], [], { ammo: true, items: [item("a1", { templateId: "lib", name: "old name", count: 2 })], library });
  const card = s.c().decks.roland.hand.find((x) => x.pageId === "shot")!;
  s.act({ type: "aim", source: "hand", cardId: card.id }, gm);
  s.act({ type: "slot", targets: ["rat"] }, gm);
  assert.equal(slotOf(s, "roland").ammo, "Arrows");
  assert.equal(s.sheet.inventory.items[0].count, 1);
});

test("Ammo helpers and the item library keep the Ammo mark only on Items", () => {
  assert.equal(isAmmo(item("x", { ammo: true })), true);
  assert.equal(isAmmo(item("x", { ammo: true, count: 0 })), false);
  assert.equal(isAmmo(item("x")), false);
  assert.equal(isAmmo(item("x", { ammo: true, kind: "trinket" })), false);
  assert.deepEqual(spendOne([item("a", { count: 2 }), item("b")], "a").map((i) => i.count), [1, 1]);
  assert.deepEqual(spendOne([item("a"), item("b")], "a").map((i) => i.id), ["b"]);
  assert.equal(cleanTemplate({ name: "Bolts", kind: "item", ammo: true })?.ammo, true);
  assert.equal(cleanTemplate({ name: "Charm", kind: "trinket", ammo: true })?.ammo, undefined);
  assert.equal(cleanTemplate({ name: "Rock", kind: "item" })?.ammo, undefined);
});

// ---- No Ammo ----

const d6 = (kind: DiceKind): Dice => ({ id: `d${n++}`, kind, counter: false, sides: 6, basePower: 0 });

test("with no Ammo, a Ranged Page is used as a Melee Page and every die rolls with disadvantage", () => {
  const s = setup([page("shot", "ranged", [d6("pierce"), d6("pierce")])], [], { ammo: true, items: [item("rope")] });
  play(s, "shot", ["rat"]);
  const slot = slotOf(s, "roland");
  const used = s.c().pages[slot.pageId];
  assert.equal(used.type, "melee");
  assert.equal(used.noAmmo, true);
  assert.equal(used.range, WEAPON_RANGE.melee);
  assert.equal(s.c().pages.shot.type, "ranged", "the Page itself is unchanged");
  assert.equal(slot.ammo, undefined);
  assert.deepEqual(s.sheet.inventory.items.map((i) => i.id), ["rope"], "nothing is spent");
  assert.ok(s.table.log.some((l) => l.includes("roland has no Ammo: shot is used as a Melee Page")));
  endTurn(s, p1);
  endTurn(s);
  assert.equal(s.table.log.filter((l) => l.includes("roland rolls with disadvantage")).length, 2, "both dice");
  assert.ok(s.hp("rat") < 30);
  assert.equal(s.c().decks.roland.discard.at(-1)?.pageId, "shot", "the card goes to the discard pile as itself");
});

test("with no Ammo, the Page reaches only its Weapon's Melee range", () => {
  const s = setup([page("shot", "ranged", [die("pierce", 3)])], [], { ammo: true });
  s.table.tokens.rat.x = 6; // 4 tiles: in Ranged range, out of Melee range.
  assert.throws(() => play(s, "shot", ["rat"]), /out of range/);
  assert.equal(s.table.tokens.roland.resources.light, 5, "nothing was paid");
  const far = setup([{ ...page("shot", "ranged", [die("pierce", 3)]), meleeRange: 4 }], [], { ammo: true });
  far.table.tokens.rat.x = 6;
  play(far, "shot", ["rat"]);
  assert.equal(far.c().pages[slotOf(far, "roland").pageId].range, 4);
});

test("with Ammo, or with the setting off, nothing rolls with disadvantage", () => {
  for (const opts of [{ ammo: true, items: [item("bullets", { ammo: true })] }, { ammo: false }]) {
    const s = setup([page("shot", "ranged", [d6("pierce")])], [], opts);
    play(s, "shot", ["rat"]);
    assert.equal(s.c().pages[slotOf(s, "roland").pageId].type, "ranged");
    endTurn(s, p1);
    endTurn(s);
    assert.ok(!s.table.log.some((l) => l.includes("disadvantage")));
  }
});
