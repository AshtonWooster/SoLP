// "Try it": runs an effect for a couple of rounds on two dummy characters, with the real rules,
// so whoever is making it can read the log and see whether it does what they meant.
import type { Page } from "./character.ts";
import { applyAction, type Actor } from "./engine.ts";
import type { EffectDef } from "./effects.ts";
import type { Resources, TableState, Token } from "./types.ts";

const gm: Actor = { uid: "try", role: "gm", displayName: "Try it" };
const DRAFT = "draft";

export interface TryResult {
  log: string[];
  you: Token;
  dummy: Token;
}

const strike = (id: string): Page => ({
  id,
  name: "Strike",
  kind: "basic",
  cost: 0,
  type: "melee",
  dice: [{ id: `${id}-1`, kind: "slash", counter: false, sides: 6, basePower: 2 }],
  effect: "",
});

function dummyToken(id: string, name: string, side: Token["side"], x: number, justice: number, extra: Partial<Token>): Token {
  const resources: Resources = { hp: 40, maxHp: 40, stagger: 25, maxStagger: 25, light: 3, maxLight: 3, sanity: 0, maxSanity: 15 };
  const page = strike(`strike-${id}`);
  return { id, name, side, x, y: 1, color: "#888", resources, justice, pages: [page], deck: [{ pageId: page.id, copies: 9 }], ...extra };
}

/**
 * "You" have the effect (with this many stacks, if it's a status) and trade Strikes (Slash 1d6+2)
 * with a Dummy standing next to you for a few rounds: you hit it, then it hits you.
 */
export function tryEffect(def: EffectDef, library: Record<string, EffectDef>, stacks = 3, rounds = 3): TryResult {
  // Everything counts as approved here: it's only a test.
  const defs: Record<string, EffectDef> = Object.fromEntries(
    Object.entries({ ...library, [DRAFT]: def }).map(([id, d]) => [id, { ...d, createdBy: undefined }]),
  );
  const status = def.kind === "status";
  const table: TableState = {
    map: { name: "Try it", width: 6, height: 3 },
    tokens: {
      you: dummyToken("you", "You", "ally", 1, 99, status ? { effects: [{ id: "e", defId: DRAFT, name: def.name || "Effect", count: stacks, description: "" }] } : { passiveEffects: [DRAFT] }),
      dummy: dummyToken("dummy", "Dummy", "enemy", 2, -99, {}),
    },
    log: [],
  };
  const ctx = { loadout: () => undefined, effectDef: (id: string) => defs[id] };
  const act = (a: Parameters<typeof applyAction>[1]) => applyAction(table, a, gm, ctx);
  act({ type: "startCombat", tokenIds: ["you", "dummy"] });
  for (let turn = 0; turn < rounds * 2 && table.combat; turn++) {
    const c = table.combat;
    const me = c.order[c.turn]?.tokenId;
    const other = me === "you" ? "dummy" : "you";
    const card = c.decks[me]?.hand[0];
    // Take turns attacking (You on odd rounds, the Dummy on even ones) so every attack lands One-Sided.
    const mine = (c.round % 2 === 1) === (me === "you") && !c.slots.some((x) => x.ownerId === other);
    if (card && mine && !table.tokens[other].status?.knockedOut) {
      try {
        act({ type: "aim", source: "hand", cardId: card.id });
        act({ type: "slot", targets: [other] });
      } catch {
        act({ type: "clearAim" });
      }
    }
    act({ type: "endTurn" });
  }
  return { log: table.log, you: table.tokens.you, dummy: table.tokens.dummy };
}
