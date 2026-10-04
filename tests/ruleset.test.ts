// Deck and inventory rules tests. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  auxiliaryDeck,
  blankArmor,
  blankCharacter,
  blankItem,
  blankPage,
  blankWeapon,
  characterChecks,
  cleanDeck,
  DECK_SIZE,
  deckChecks,
  equipmentPages,
  inventoryChecks,
  maxCopies,
  proficiencyCount,
} from "../shared/ruleset.ts";

function armed() {
  const c = blankCharacter("p1", "Roland");
  const sword = blankWeapon();
  sword.name = "Durandal";
  const suit = blankArmor();
  suit.name = "Black Suit";
  c.weapons = [sword];
  c.armor = suit;
  return { c, basic: sword.pages[0], special: sword.pages[1], armorBasic: suit.pages[0] };
}

test("proficiencies: 2 at Rank 9, +2 per Rank Up", () => {
  assert.deepEqual([9, 8, 7, 1].map(proficiencyCount), [2, 4, 6, 18]);
});

test("the Combat Deck draws from every equipped Weapon and the Armor", () => {
  const { c } = armed();
  assert.deepEqual(equipmentPages(c).map((s) => s.from), ["Durandal", "Durandal", "Black Suit", "Black Suit"]);
});

test("Basic Pages: any number of copies; Special Pages: one", () => {
  const { basic, special } = armed();
  assert.equal(maxCopies(basic), DECK_SIZE);
  assert.equal(maxCopies(special), 1);
});

test("a legal 12-page deck passes; wrong sizes and extra Special copies fail", () => {
  const { c, basic, special, armorBasic } = armed();
  c.deck = [
    { pageId: basic.id, copies: 7 },
    { pageId: armorBasic.id, copies: 4 },
    { pageId: special.id, copies: 1 },
  ];
  assert.ok(deckChecks(c).every((ch) => ch.ok));
  c.deck[0].copies = 6;
  assert.match(deckChecks(c).find((ch) => !ch.ok)!.text, /11 of 12/);
  c.deck[0].copies = 6;
  c.deck[2].copies = 2;
  assert.ok(deckChecks(c).some((ch) => !ch.ok && /unique/.test(ch.text)));
});

test("removing Equipment flags its Pages, and cleanDeck drops them", () => {
  const { c, basic, armorBasic } = armed();
  c.deck = [
    { pageId: basic.id, copies: 6 },
    { pageId: armorBasic.id, copies: 6 },
  ];
  c.armor = null;
  assert.ok(deckChecks(c).some((ch) => !ch.ok && /no longer on your Equipment/.test(ch.text)));
  assert.deepEqual(cleanDeck(c), [{ pageId: basic.id, copies: 6 }]);
});

test("the Auxiliary Deck holds each Tool's Page, one per item in a stack; Trinkets and Items aren't in it", () => {
  const { c } = armed();
  const grenade = blankItem("tool");
  grenade.name = "Grenade";
  grenade.stacking = true;
  grenade.count = 3;
  grenade.maxStack = 5;
  const knife = blankItem("tool");
  const ore = blankItem("item");
  const charm = blankItem("trinket");
  c.inventory.items = [grenade, knife, ore];
  c.inventory.trinket = charm;
  assert.deepEqual(auxiliaryDeck(c).map((a) => a.copies), [3, 1]);
  assert.equal(auxiliaryDeck(c)[0].page, grenade.page);
});

test("inventory: 9 Slots, stacks within their max, only Trinkets in the Trinket Slot", () => {
  const { c } = armed();
  c.inventory.items = Array.from({ length: 9 }, () => blankItem("item"));
  assert.ok(inventoryChecks(c).every((ch) => ch.ok));
  c.inventory.items.push(blankItem("item"));
  assert.match(inventoryChecks(c)[0].text, /10 of 9/);
  c.inventory.items = [{ ...blankItem("item"), stacking: true, count: 6, maxStack: 5 }];
  assert.ok(inventoryChecks(c).some((ch) => !ch.ok && /max is 5/.test(ch.text)));
  c.inventory.items = [];
  c.inventory.trinket = blankItem("tool");
  assert.ok(inventoryChecks(c).some((ch) => !ch.ok && /Trinket Slot/.test(ch.text)));
});

test("the character checklist includes the deck and inventory", () => {
  const { c } = armed();
  const steps = new Set(characterChecks(c).map((ch) => ch.step));
  assert.ok(steps.has("Decks") && steps.has("Inventory"));
  void blankPage;
});

test("usable items: consumable ones count down, then one of the stack is used up, then they're gone", async () => {
  const { useItem, useItemIn, isUsable } = await import("../shared/ruleset.ts");
  const salve = { ...blankItem("item"), id: "s", usable: true, consumable: true, maxUses: 2, uses: 2, stacking: true, count: 2, maxStack: 5 };
  assert.ok(isUsable(salve) && isUsable(blankItem("tool")) && !isUsable(blankItem("item")));
  const a = useItem(salve)!;
  assert.deepEqual([a.count, a.uses], [2, 1]);
  const b = useItem(a)!;
  assert.deepEqual([b.count, b.uses], [1, 2], "one used up; the next starts fresh");
  const c = useItem(useItem(b)!);
  assert.equal(c, null, "last one gone");
  const lamp = { ...blankItem("item"), usable: true };
  assert.equal(useItem(lamp), lamp, "not consumable: never runs out");
  assert.deepEqual(useItemIn([salve, lamp], "s").map((i) => i.uses), [1, undefined]);
});
