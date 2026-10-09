// The main menu's player list. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Character } from "../shared/character.ts";
import { playerList } from "../shared/players.ts";
import { blankCharacter } from "../shared/ruleset.ts";
import type { GameDoc } from "../shared/types.ts";

const game: GameDoc = {
  name: "G",
  gmId: "gm",
  memberIds: ["gm", "p1", "p2"],
  members: { gm: { displayName: "Gamemaster", role: "gm" }, p1: { displayName: "ashton", role: "player" }, p2: { displayName: "newbie", role: "player" } },
  createdAt: 1,
};
const roland: Character = { ...blankCharacter("p1", "ashton"), name: "Roland", portrait: "https://example.com/roland.png" };

test("lists players only, by username, in join order", () => {
  const list = playerList("g1", game, { p1: roland }, true);
  assert.deepEqual(list.map((p) => [p.uid, p.username]), [["p1", "ashton"], ["p2", "newbie"]]);
});

test("each player shows a preview of their character: name and picture", () => {
  const [p1] = playerList("g1", game, { p1: roland }, false);
  assert.deepEqual(p1.character, { name: "Roland", portrait: "https://example.com/roland.png" });
  const [noPic] = playerList("g1", game, { p1: { ...roland, portrait: undefined, name: "  " } }, false);
  assert.deepEqual(noPic.character, { name: "Unnamed character" });
});

test("a player with no character shows just their username", () => {
  const [, p2] = playerList("g1", game, { p1: roland }, true);
  assert.equal(p2.character, undefined);
  assert.equal(p2.href, undefined);
});

test("only the GM can click through to a player's character page", () => {
  assert.equal(playerList("g1", game, { p1: roland }, true)[0].href, "/games/g1/characters/p1");
  assert.equal(playerList("g1", game, { p1: roland }, false)[0].href, undefined);
});
