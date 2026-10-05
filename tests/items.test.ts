// The GM's item library and inventories. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Inventory, ItemTemplate } from "../shared/character.ts";
import { addFromLibrary, auxiliaryDeck, blankCharacter, blankTemplate, cleanTemplate, linkInventory, linkItem } from "../shared/ruleset.ts";

const potion: ItemTemplate = { ...blankTemplate("item"), name: "Potion", stacking: true, maxStack: 3 };
const sword: ItemTemplate = { ...blankTemplate("item"), name: "Old Sword" };
const inv = (slotCount = 2): Inventory => ({ slotCount, items: [], trinket: null });

const add = (i: Inventory, id: string, t: ItemTemplate) => {
  const r = addFromLibrary(i, id, t);
  if ("error" in r) throw new Error(r.error);
  return { ...i, items: r.items };
};

test("adding stacking items fills a stack up to its max, then starts a new Slot", () => {
  let i = inv(3);
  for (let n = 0; n < 4; n++) i = add(i, "potion", potion);
  assert.deepEqual(i.items.map((x) => x.count), [3, 1]);
  assert.ok(i.items.every((x) => x.templateId === "potion"));
});

test("non-stacking items take a Slot each; a full inventory refuses", () => {
  let i = add(add(inv(2), "sword", sword), "sword", sword);
  assert.equal(i.items.length, 2);
  const r = addFromLibrary(i, "sword", sword);
  assert.ok("error" in r && /2 Slots are full/.test(r.error));
  // A full inventory still takes more on a stack with room.
  i = { ...inv(1), items: add(inv(1), "potion", potion).items };
  assert.equal(add(i, "potion", potion).items[0].count, 2);
});

test("inventory items follow the GM's edits to the library, keeping their own count", () => {
  let i = add(inv(3), "potion", potion);
  i = add(i, "potion", potion);
  const c = { ...blankCharacter("p1", "Roland"), inventory: i };
  const edited = { ...potion, name: "Greater Potion", description: "Heals 5", maxStack: 1 };
  const linked = linkInventory(c, { potion: edited }).inventory.items[0];
  assert.equal(linked.name, "Greater Potion");
  assert.equal(linked.description, "Heals 5");
  assert.equal(linked.count, 1, "count clamped to the new max");
  // A deleted library item keeps its last copy.
  assert.equal(linkItem(c.inventory.items[0], {}).name, "Potion");
});

test("a Usable item is a Page with dice in the Auxiliary Deck, one copy per item in the stack", () => {
  const grenade = cleanTemplate({ name: "Grenade", kind: "tool", stacking: true, maxStack: 5, page: { cost: 1, dice: [{ kind: "blunt", sides: 6, basePower: 1 }] } })!;
  let i = add(inv(3), "grenade", grenade);
  i = add(i, "grenade", grenade);
  const c = linkInventory({ ...blankCharacter("p1", "Roland"), inventory: i }, { grenade });
  const aux = auxiliaryDeck(c);
  assert.equal(aux.length, 1);
  assert.equal(aux[0].copies, 2);
  assert.equal(aux[0].page.name, "Grenade");
  assert.equal(aux[0].page.dice[0].kind, "blunt");
});

test("imported items are cleaned: unknown fields dropped, bad values fixed, only http(s) art", () => {
  const t = cleanTemplate({ name: "x".repeat(500), kind: "weird", maxStack: -3, stacking: true, image: "javascript:alert(1)", evil: true })!;
  assert.equal(t.name.length, 120);
  assert.equal(t.kind, "item");
  assert.equal(t.maxStack, 1);
  assert.equal(t.image, undefined);
  assert.equal((t as Record<string, unknown>).evil, undefined);
  assert.equal(cleanTemplate("nope"), null);
});
