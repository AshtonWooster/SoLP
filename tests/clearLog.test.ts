// Clearing the table log from game settings. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { clearLog, logClearedAt, logClearRequested } from "../shared/clearLog.ts";
import { newTable } from "../shared/engine.ts";
import type { GameDoc } from "../shared/types.ts";

const game = (settings?: GameDoc["settings"]): GameDoc =>
  ({ name: "G", gmId: "gm", memberIds: ["gm"], members: { gm: { displayName: "GM", role: "gm" } }, settings }) as GameDoc;

test("a game that never cleared its log asks for nothing, so older games behave the same", () => {
  assert.equal(logClearedAt(game()), 0);
  assert.equal(logClearedAt(game({})), 0);
  assert.equal(logClearedAt(undefined), 0);
  assert.equal(logClearRequested(0, game()), false);
});

test("a new Clear log stamp is a request; one the host already acted on isn't", () => {
  assert.equal(logClearRequested(0, game({ logClearedAt: 1000 })), true);
  assert.equal(logClearRequested(1000, game({ logClearedAt: 1000 })), false);
  assert.equal(logClearRequested(1000, game({ logClearedAt: 2000 })), true);
});

test("a bad stamp is ignored", () => {
  assert.equal(logClearedAt(game({ logClearedAt: "soon" as unknown as number })), 0);
  assert.equal(logClearedAt(game({ logClearedAt: NaN })), 0);
});

test("clearing empties the log and keeps the rest of the table", () => {
  const t = newTable();
  t.log.push("Ashe rolls 1d6.", "  4.");
  const tokens = t.tokens;
  assert.equal(clearLog(t), true);
  assert.deepEqual(t.log, []);
  assert.equal(t.tokens, tokens);
  assert.equal(clearLog(t), false);
});
