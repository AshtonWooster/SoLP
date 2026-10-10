// The token popup's gear and deck preview. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Character } from "../shared/character.ts";
import { blankArmor, blankCharacter, blankPage, blankWeapon } from "../shared/ruleset.ts";
import { tokenGear } from "../shared/tokenPreview.ts";
import type { Token } from "../shared/types.ts";

const resources = { hp: 10, maxHp: 10, stagger: 5, maxStagger: 5, light: 3, maxLight: 3, sanity: 0, maxSanity: 15 };
const token = (over: Partial<Token>): Token => ({ id: "t", name: "T", side: "player", x: 0, y: 0, color: "#fff", resources, ...over });

const sword = { ...blankWeapon(), name: "Sword", hands: 2 as const };
const coat = { ...blankArmor(), name: "Coat" };
const roland: Character = {
  ...blankCharacter("p1", "ashton"),
  name: "Roland",
  weapons: [sword],
  armor: coat,
  augment: { name: "Black Silence", description: "", passives: [{ id: "x", name: "Furioso", cost: 1, description: "" }] },
  deck: [
    { pageId: sword.pages[0].id, copies: 3 },
    { pageId: coat.pages[1].id, copies: 1 },
    { pageId: "gone", copies: 2 },
  ],
};

test("a player's token shows their weapons, armor and augment from the character sheet", () => {
  const g = tokenGear(token({ ownerId: "p1" }), roland);
  assert.deepEqual(g.weapons, [{ id: sword.id, name: "Sword", hands: 2 }]);
  assert.deepEqual(g.armor, { name: "Coat" });
  assert.deepEqual(g.augment, { name: "Black Silence", passives: ["Furioso"] });
});

test("a player's deck comes from their sheet, dropping Pages no longer on their gear", () => {
  const g = tokenGear(token({ ownerId: "p1" }), roland);
  assert.deepEqual(
    g.deck.map((e) => [e.page.id, e.copies]),
    [
      [sword.pages[0].id, 3],
      [coat.pages[1].id, 1],
    ],
  );
});

test("missing gear is left out", () => {
  const g = tokenGear(token({}), { ...blankCharacter("p1", "x"), weapons: [], armor: null });
  assert.deepEqual(g.weapons, []);
  assert.equal(g.armor, undefined);
  assert.equal(g.augment, undefined);
});

test("a player token whose sheet isn't loaded shows no deck", () => {
  assert.deepEqual(tokenGear(token({ ownerId: "p1" })).deck, []);
});

test("a GM character's deck is the token's own, or one of each Page if none was set", () => {
  const a = { ...blankPage("basic"), name: "Claw" };
  const b = { ...blankPage("special"), name: "Roar" };
  const set = tokenGear(
    token({
      side: "enemy",
      pages: [a, b],
      deck: [
        { pageId: b.id, copies: 2 },
        { pageId: a.id, copies: 0 },
      ],
    }),
  );
  assert.deepEqual(
    set.deck.map((e) => [e.page.name, e.copies]),
    [["Roar", 2]],
  );
  const unset = tokenGear(token({ side: "enemy", pages: [a, b] }));
  assert.deepEqual(
    unset.deck.map((e) => [e.page.name, e.copies]),
    [
      ["Claw", 1],
      ["Roar", 1],
    ],
  );
});

test("a GM character's gear comes from the character it was placed from", () => {
  const g = tokenGear(token({ side: "enemy", pages: [] }), roland);
  assert.equal(g.weapons[0].name, "Sword");
  assert.deepEqual(g.deck, []);
});
