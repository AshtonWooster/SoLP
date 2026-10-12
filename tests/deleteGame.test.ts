// Typing the game's name to delete it. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { deleteNameMatches } from "../shared/deleteGame.ts";

test("the game is deleted only when its exact name is typed", () => {
  assert.equal(deleteNameMatches("Backstreets Run", "Backstreets Run"), true);
  assert.equal(deleteNameMatches("  Backstreets Run ", "Backstreets Run"), true);
  assert.equal(deleteNameMatches("backstreets run", "Backstreets Run"), false);
  assert.equal(deleteNameMatches("Backstreets", "Backstreets Run"), false);
  assert.equal(deleteNameMatches("", "Backstreets Run"), false);
});

test("an empty name never matches, even for a game with a blank name", () => {
  assert.equal(deleteNameMatches("", ""), false);
  assert.equal(deleteNameMatches("   ", " "), false);
});
