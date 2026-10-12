// What players can't see on the GM's characters. Run with `npm run test:engine`.
// Dice here have 1 side, so they always roll 1 and Final Power = 1 + Base Power.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Dice, DiceKind, NpcTemplate, Page } from "../shared/character.ts";
import { applyAction, type Actor, type EngineContext, type Loadout } from "../shared/engine.ts";
import { DEFAULT_STAT_FORMULAS } from "../shared/formulas.ts";
import { playerView } from "../shared/maps.ts";
import { blankNpc, npcSpawnData } from "../shared/ruleset.ts";
import { concealLine, isSecret, revealLog, secret, tableForGm, tableForPlayers, withheld } from "../shared/secrets.ts";
import { tokenGear } from "../shared/tokenPreview.ts";
import type { TableAction, TableState, Token } from "../shared/types.ts";

const gm: Actor = { uid: "gm", role: "gm", displayName: "GM" };
const p1: Actor = { uid: "p1", role: "player", displayName: "P1" };

let n = 0;
const die = (kind: DiceKind, fp: number): Dice => ({ id: `d${n++}`, kind, counter: false, sides: 1, basePower: fp - 1 });
const page = (id: string, dice: Dice[], cost = 1): Page => ({ id, name: id, kind: "basic", cost, type: "melee", dice, effect: "" });

function token(id: string, side: Token["side"], x: number, extra: Partial<Token> = {}): Token {
  return {
    id, name: id, side, x, y: 2, color: "#fff",
    resources: { hp: 30, maxHp: 30, stagger: 20, maxStagger: 20, light: 5, maxLight: 5, sanity: 0, maxSanity: 15 },
    ...extra,
  };
}

const ratPages = [page("bite", [die("slash", 2)]), page("lunge", [die("pierce", 3)])];

/** Roland (player, always first) next to a Rat (enemy) with Pages, Effects, Resistances and Passives. */
function setup() {
  const table: TableState = {
    map: { name: "m", width: 16, height: 10 },
    tokens: {
      roland: token("roland", "player", 2, { ownerId: "p1", justice: 100, resistances: { slash: 1, pierce: 1, blunt: 1 } }),
      rat: token("rat", "enemy", 3, {
        justice: -100,
        pages: ratPages,
        deck: [{ pageId: "bite", copies: 6 }, { pageId: "lunge", copies: 6 }],
        resistances: { slash: 2, pierce: 0.5, blunt: 1 },
        staggerResistances: { slash: 1, pierce: 1, blunt: 1 },
        effects: [{ id: "e1", name: "Burn", count: 3, description: "" }],
        passiveEffects: ["thorns"],
        gear: { weapons: [{ id: "w", name: "Teeth", hands: 1 }], augment: { name: "Rat King", passives: ["Swarm"] } },
      }),
    },
    log: [],
  };
  const slash = page("slash", [die("slash", 4)]);
  const loadout: Loadout = { pages: { slash }, deck: Array(12).fill("slash"), aux: [] };
  const ctx: EngineContext = { loadout: (id) => (id === "roland" ? loadout : undefined) };
  const act = (a: TableAction, who: Actor = gm) => applyAction(table, a, who, ctx);
  return { table, act };
}

/** Roland hits the Rat with a 4-power Slash (8 damage through its 2x Slash Resistance). */
function hitRat(s: ReturnType<typeof setup>) {
  s.act({ type: "startCombat", tokenIds: ["roland", "rat"] });
  const card = s.table.combat!.decks.roland.hand[0];
  s.act({ type: "aim", source: "hand", cardId: card.id }, p1);
  s.act({ type: "slot", targets: ["rat"] }, p1);
  s.act({ type: "endTurn" }, p1);
  s.act({ type: "endTurn" });
}

const forPlayers = (t: TableState) => tableForPlayers(playerView(t));

test("by default players see what they always have: resources, Justice and Effects, but not the Deck, gear or Resistances", () => {
  const s = setup();
  const rat = forPlayers(s.table).tokens.rat;
  assert.deepEqual(rat.resources, s.table.tokens.rat.resources);
  assert.equal(rat.justice, -100);
  assert.equal(rat.effects?.length, 1);
  assert.equal(rat.pages, undefined, "the Rat's Pages aren't sent");
  assert.equal(rat.deck, undefined);
  assert.equal(rat.gear, undefined);
  assert.equal(rat.passiveEffects, undefined);
  assert.equal(rat.resistances, undefined);
  assert.equal(rat.staggerResistances, undefined);
  assert.ok(rat.concealed && withheld(rat, "deck") && !withheld(rat, "hp"));
  // Players' own characters are never touched.
  assert.deepEqual(forPlayers(s.table).tokens.roland, s.table.tokens.roland);
  // The GM's copy keeps everything.
  assert.deepEqual(tableForGm(s.table).tokens.rat, s.table.tokens.rat);
});

test("only the GM sets secrets, and only on the GM's characters", () => {
  const s = setup();
  assert.throws(() => s.act({ type: "setSecret", tokenId: "rat", secret: { hp: true } }, p1), /GM/);
  assert.throws(() => s.act({ type: "setSecret", tokenId: "roland", secret: { hp: true } }), /Players' characters/);
  assert.equal(s.act({ type: "setSecret", tokenId: "rat", secret: { hp: true, bogus: true } as never }), true);
  assert.deepEqual(s.table.tokens.rat.secret, { hp: true }, "unknown parts are dropped");
  assert.equal(s.act({ type: "setSecret", tokenId: "rat", secret: { hp: true } }), false, "no change");
  assert.equal(isSecret(s.table.tokens.roland, "hp"), false);
});

test("hidden Health, Stagger, Light, Sanity, Justice and Effects aren't sent to players", () => {
  const s = setup();
  s.act({ type: "setSecret", tokenId: "rat", secret: { hp: true, stagger: true, light: true, sanity: true, justice: true, effects: true } });
  const rat = forPlayers(s.table).tokens.rat;
  assert.deepEqual(rat.resources, { hp: 0, maxHp: 0, stagger: 0, maxStagger: 0, light: 0, maxLight: 0, sanity: 0, maxSanity: 0 });
  assert.equal(rat.justice, undefined);
  assert.equal(rat.effects, undefined);
  assert.equal(rat.effectUses, undefined);
  assert.ok(withheld(rat, "hp") && withheld(rat, "justice"));
  // The GM still has it all.
  assert.equal(s.table.tokens.rat.resources.hp, 30);
  assert.equal(s.table.tokens.rat.justice, -100);
});

test("the GM can show the Deck, gear and Resistances", () => {
  const s = setup();
  s.act({ type: "setSecret", tokenId: "rat", secret: { deck: false, gear: false, resistances: false } });
  const rat = forPlayers(s.table).tokens.rat;
  assert.equal(rat.pages?.length, 2);
  assert.deepEqual(rat.resistances, { slash: 2, pierce: 0.5, blunt: 1 });
  const gear = tokenGear(rat);
  assert.equal(gear.augment?.name, "Rat King");
  assert.deepEqual(gear.weapons.map((w) => w.name), ["Teeth"]);
  assert.equal(gear.deck.reduce((a, e) => a + e.copies, 0), 12);
});

test("hidden Health stays out of the log and the clash animation; the GM's log reads in full", () => {
  const s = setup();
  s.act({ type: "setSecret", tokenId: "rat", secret: { hp: true, stagger: true } });
  hitRat(s);
  assert.equal(s.table.tokens.rat.resources.hp, 22);
  const players = forPlayers(s.table);
  const gmLog = tableForGm(s.table).log;
  assert.ok(gmLog.includes("  rat takes 8 slash damage (22/30 Health)."), gmLog.join("\n"));
  assert.ok(gmLog.includes("  rat takes 4 Stagger damage (16/20)."));
  assert.ok(players.log.includes("  rat takes slash damage."), players.log.join("\n"));
  assert.ok(players.log.includes("  rat takes Stagger damage."));
  assert.ok(!players.log.some((l) => /22|/.test(l)), "no Health and no markers reach players");
  // The animation's before and after don't give it away either.
  const fx = players.combat!.fx!.at(-1)!;
  assert.equal(fx.before!.rat.resources.hp, 0);
  assert.ok(fx.rounds.every((r) => !r.after || r.after.rat.resources.hp === 0));
  assert.equal(s.table.combat!.fx!.at(-1)!.rounds.at(-1)!.after!.rat.resources.hp, 22, "the GM's copy is untouched");
  // Players' own numbers still show.
  assert.equal(fx.before!.roland.resources.hp, 30);
});

test("without secrets the log reads the same for players as for the GM", () => {
  const s = setup();
  hitRat(s);
  assert.deepEqual(forPlayers(s.table).log, tableForGm(s.table).log);
});

test("a hidden Justice is left out of Speed and Story Rolls", () => {
  const s = setup();
  s.act({ type: "setSecret", tokenId: "rat", secret: { justice: true } });
  s.act({ type: "startCombat", tokenIds: ["roland", "rat"] });
  s.act({ type: "storyRoll", tokenId: "rat", stat: "justice" });
  const players = forPlayers(s.table);
  const entry = players.combat!.order.find((x) => x.tokenId === "rat")!;
  assert.equal(entry.bonus, 0);
  assert.equal(entry.roll, entry.speed);
  assert.ok(!players.log.some((l) => l.includes("-100")), players.log.join("\n"));
  assert.ok(tableForGm(s.table).log.some((l) => l.includes("-100")));
  assert.match(players.log.at(-1)!, /^rat makes a Justice Story Roll: \d+\.$/);
});

test("a hidden Deck: unplayed Pages aren't sent; Pages the enemy plays are", () => {
  const s = setup();
  s.act({ type: "startCombat", tokenIds: ["roland", "rat"] });
  let c = forPlayers(s.table).combat!;
  assert.ok(!c.pages.bite && !c.pages.lunge, "none of the Rat's Pages before it plays one");
  assert.ok(c.pages.slash, "the party's Pages are there");
  assert.ok(c.decks.rat.hand.every((x) => x.pageId === "hidden"));
  // On the Rat's turn the GM plays Bite: now players see it.
  s.act({ type: "endTurn" }, p1);
  const bite = s.table.combat!.decks.rat.hand.find((x) => x.pageId === "bite")!;
  s.act({ type: "aim", source: "hand", cardId: bite.id });
  s.act({ type: "slot", targets: ["roland"] });
  c = forPlayers(s.table).combat!;
  assert.ok(c.pages.bite);
  assert.ok(!c.pages.lunge);
});

test("log markers: concealLine drops a fully secret line and keeps the rest", () => {
  const rat = { id: "rat", side: "enemy" as const };
  assert.equal(secret({ id: "r", side: "player" }, "hp", "x"), "x", "players' text has no markers");
  const line = `rat takes ${secret(rat, "hp", "5 ")}damage.`;
  assert.equal(revealLog(line), "rat takes 5 damage.");
  assert.equal(concealLine(line, () => true), "rat takes damage.");
  assert.equal(concealLine(line, () => false), "rat takes 5 damage.");
  assert.equal(concealLine(secret(rat, "effects", "  rat gains 2 Burn."), () => true), null);
  assert.equal(concealLine("Combat started.", () => true), "Combat started.");
});

test("a GM character's secrets go to every copy placed on the map, with its gear names", () => {
  const t: NpcTemplate = { ...blankNpc(), name: "Sweeper", secret: { hp: true, deck: false } };
  t.augment = { name: "Night Shift", description: "", passives: [{ id: "p", name: "Sweep", cost: 1, description: "" }] };
  const data = npcSpawnData(t, DEFAULT_STAT_FORMULAS);
  assert.deepEqual(data.secret, { hp: true, deck: false });
  assert.deepEqual(data.gear?.augment, { name: "Night Shift", passives: ["Sweep"] });
  const s = setup();
  s.act({ type: "spawnEnemy", templateId: "sweeper", template: data, x: 8, y: 8 });
  const placed = Object.values(s.table.tokens).find((x) => x.templateId === "sweeper")!;
  assert.deepEqual(placed.secret, { hp: true, deck: false });
  assert.ok(isSecret(placed, "hp") && !isSecret(placed, "deck") && isSecret(placed, "gear"));
  assert.equal(placed.gear?.augment?.name, "Night Shift");
});

test("an existing game's enemies, with no secrets saved, show players the same as before", () => {
  const s = setup();
  const rat = forPlayers(s.table).tokens.rat;
  for (const part of ["hp", "stagger", "light", "sanity", "justice", "effects"] as const) assert.equal(withheld(rat, part), false, part);
});
