// Story Roll animation: what the table records for screens to play, the "Players can make Story
// Rolls" setting, and what players' copies leave out. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAction, type Actor, type EngineContext } from "../shared/engine.ts";
import { playerView } from "../shared/maps.ts";
import { tableForPlayers } from "../shared/secrets.ts";
import { playersCanStoryRoll, type GameDoc, type TableState, type Token } from "../shared/types.ts";
import { STORY_TIMES, nextStoryStep, rollingStory, storyBreakdown, storyRollToPlay, storyTotal } from "../src/components/storyRoll.ts";

const gm: Actor = { uid: "gm", role: "gm", displayName: "GM" };
const ann: Actor = { uid: "ann", role: "player", displayName: "Ann" };
const resources = { hp: 10, maxHp: 10, stagger: 5, maxStagger: 5, light: 3, maxLight: 3, sanity: 0, maxSanity: 15 };
const token = (id: string, side: Token["side"], x: number, extra: Partial<Token> = {}): Token => ({ id, name: id, side, x, y: 0, color: "#fff", resources, ...extra });
const ctx: EngineContext = { loadout: () => ({ pages: {}, deck: [], aux: [], stats: { insight: 3 } }) };

function table(): TableState {
  return {
    map: { id: "lib", name: "m", width: 8, height: 4 },
    tokens: { annie: token("annie", "player", 0, { ownerId: "ann" }), rat: token("rat", "enemy", 6, { justice: 2 }) },
    log: [],
  };
}

const game = (settings?: GameDoc["settings"]) => ({ name: "g", gmId: "gm", members: {}, settings }) as unknown as GameDoc;

test("players make their own Story Rolls unless the GM turns it off", () => {
  assert.equal(playersCanStoryRoll(undefined), true);
  assert.equal(playersCanStoryRoll(game()), true);
  assert.equal(playersCanStoryRoll(game({ popupRewards: true })), true);
  assert.equal(playersCanStoryRoll(game({ playerStoryRolls: true })), true);
  assert.equal(playersCanStoryRoll(game({ playerStoryRolls: false })), false);
});

test("with player Story Rolls off, players roll only when a popup asks; the GM still rolls", () => {
  const off: EngineContext = { ...ctx, playersStoryRoll: () => false };
  const t = table();
  assert.throws(() => applyAction(t, { type: "storyRoll", tokenId: "annie", stat: "insight" }, ann, off), /turned off Story Rolls/);
  assert.equal(t.storyRoll, undefined);
  assert.equal(t.log.length, 0);

  applyAction(t, { type: "sendPopup", id: "p", roll: { stat: "insight" } }, gm);
  applyAction(t, { type: "popupRoll", popupId: "p" }, ann, off);
  assert.equal(t.storyRoll?.tokenId, "annie");

  applyAction(t, { type: "storyRoll", tokenId: "rat", stat: "justice" }, gm, off);
  assert.equal(t.storyRoll?.tokenId, "rat");

  // On (or a context that doesn't say): players roll as before.
  applyAction(t, { type: "storyRoll", tokenId: "annie", stat: "insight" }, ann, { ...ctx, playersStoryRoll: () => true });
  assert.equal(t.storyRoll?.tokenId, "annie");
});

test("a Story Roll records its roll and Stat for screens to play, each with a new id", () => {
  const t = table();
  applyAction(t, { type: "storyRoll", tokenId: "annie", stat: "insight" }, ann, ctx);
  const first = t.storyRoll!;
  assert.equal(first.tokenId, "annie");
  assert.equal(first.stat, "insight");
  assert.equal(first.bonus, 3);
  assert.ok(first.roll >= 1 && first.roll <= 20);
  assert.match(t.log.at(-1)!, new RegExp(`^annie makes a Insight Story Roll: ${first.roll}\\+3 = ${first.roll + 3} \\((success|failure|between a failure and a success)\\)\\.$`));

  applyAction(t, { type: "storyRoll", tokenId: "annie", stat: "insight" }, ann, ctx);
  assert.notEqual(t.storyRoll!.id, first.id);
});

test("a GM popup's roll plays like any Story Roll", () => {
  const t = table();
  applyAction(t, { type: "sendPopup", id: "p", roll: { stat: "insight" } }, gm);
  applyAction(t, { type: "popupRoll", popupId: "p" }, ann, ctx);
  assert.equal(t.storyRoll?.tokenId, "annie");
  assert.equal(t.storyRoll?.bonus, 3);
});

test("players' copy keeps a player's bonus but not a hidden Justice", () => {
  const t = table();
  applyAction(t, { type: "storyRoll", tokenId: "annie", stat: "insight" }, ann, ctx);
  assert.deepEqual(tableForPlayers(t).storyRoll, t.storyRoll);

  // The GM shows a character's Justice unless they hide it.
  applyAction(t, { type: "storyRoll", tokenId: "rat", stat: "justice" }, gm, ctx);
  assert.equal(tableForPlayers(t).storyRoll!.bonus, 2);

  t.tokens.rat.secret = { justice: true };
  applyAction(t, { type: "storyRoll", tokenId: "rat", stat: "justice" }, gm, ctx);
  const theirs = tableForPlayers(t).storyRoll!;
  assert.equal(theirs.bonus, undefined);
  assert.equal(theirs.roll, t.storyRoll!.roll);
  // The GM's character still has the bonus.
  assert.equal(t.storyRoll!.bonus, 2);
});

test("a Story Roll under the fog plays only on the roller's own phone", () => {
  const t = table();
  applyAction(t, { type: "fogAll", mapId: "lib", hidden: true }, gm);
  applyAction(t, { type: "storyRoll", tokenId: "annie", stat: "insight" }, ann, ctx);
  assert.equal(playerView(t).storyRoll, undefined);
  assert.equal(playerView(t, "ann").storyRoll?.id, t.storyRoll!.id);
});

test("a screen's first look plays nothing; a new roll plays once, then settles", () => {
  const t = table();
  applyAction(t, { type: "storyRoll", tokenId: "annie", stat: "insight" }, ann, ctx);
  assert.equal(storyRollToPlay(undefined, t), null);
  assert.equal(storyRollToPlay(t.storyRoll!.id, t), null);

  const seen = t.storyRoll!.id;
  applyAction(t, { type: "storyRoll", tokenId: "annie", stat: "insight" }, ann, ctx);
  const step = storyRollToPlay(seen, t)!;
  assert.equal(step.stage, "roll");
  assert.equal(step.tokenId, "annie");
  assert.equal(step.label, "Insight");
  assert.equal(storyTotal(step), t.storyRoll!.roll + 3);
  const settle = nextStoryStep(step)!;
  assert.equal(settle.stage, "settle");
  assert.equal(nextStoryStep(settle), null);
  assert.ok(STORY_TIMES.roll > 0 && STORY_TIMES.settle > 0);
});

test("a roll by someone no longer on the table plays nothing", () => {
  const t = table();
  applyAction(t, { type: "storyRoll", tokenId: "annie", stat: "insight" }, ann, ctx);
  delete t.tokens.annie;
  assert.equal(storyRollToPlay(null, t), null);
});

test("the die shows faces of 1d20 plus the Stat, and lands on the total", () => {
  assert.equal(rollingStory({ bonus: 3 }, () => 0), 4);
  assert.equal(rollingStory({ bonus: 3 }, () => 0.999), 23);
  assert.equal(rollingStory({}, () => 0.999), 20);
  assert.equal(storyBreakdown({ roll: 14, bonus: 3 }), "14 + 3");
  assert.equal(storyBreakdown({ roll: 14, bonus: -2 }), "14 − 2");
  assert.equal(storyBreakdown({ roll: 14 }), "14");
  assert.equal(storyTotal({ roll: 14 }), 14);
});
