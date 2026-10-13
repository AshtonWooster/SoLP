// What players may know about the GM's characters (enemies, allies, neutrals). The GM picks, per
// character, which parts of its sheet players can't see: its Health, Stagger, Light, Sanity, Justice,
// Effects, Resistances, Deck and gear. Hidden parts never leave the GM's browser: `tableForPlayers`
// takes them out of the table, the log and the clash animations before the host sends it.
//
// Log lines name these values through `secret(...)` markers, so each viewer's copy can keep or
// drop them: `revealLog` (the GM) keeps the text, `tableForPlayers` drops what's hidden.
import type { ClashFx, CombatState, FxState, Resources, TableState, Token } from "./types.ts";

export type SheetPart = "hp" | "stagger" | "light" | "sanity" | "justice" | "effects" | "resistances" | "deck" | "gear";

/** For each part, whether players can't see it. Missing parts follow SHEET_PARTS' defaults. */
export type SheetSecrets = Partial<Record<SheetPart, boolean>>;

export const SHEET_PARTS: { key: SheetPart; label: string; hint: string; hiddenByDefault: boolean }[] = [
  { key: "hp", label: "Health", hint: "Health and max Health, and the damage it takes", hiddenByDefault: false },
  { key: "stagger", label: "Stagger Resist", hint: "Stagger Resist and the Stagger damage it takes", hiddenByDefault: false },
  { key: "light", label: "Light", hint: "Light and max Light", hiddenByDefault: false },
  { key: "sanity", label: "Sanity", hint: "Sanity and max Sanity", hiddenByDefault: false },
  { key: "justice", label: "Justice", hint: "Justice, and its part of Speed and Story Rolls", hiddenByDefault: false },
  { key: "effects", label: "Effects", hint: "Burn, Poise and the other Effects on it", hiddenByDefault: false },
  // Players have never seen these three for the GM's characters, so they stay hidden unless the GM shows them.
  { key: "resistances", label: "Resistances", hint: "Damage and Stagger Resistances", hiddenByDefault: true },
  { key: "deck", label: "Deck", hint: "Its Pages and Combat Deck (Pages it plays are still shown)", hiddenByDefault: true },
  { key: "gear", label: "Weapons, Armor & Augment", hint: "Its gear, Augment and Passives", hiddenByDefault: true },
];

const PARTS = new Set<string>(SHEET_PARTS.map((p) => p.key));

/** Only the GM's characters can have secrets; players' own and their party's characters are open. */
export function isSecret(t: Pick<Token, "side" | "secret"> | undefined, part: SheetPart): boolean {
  if (!t || t.side === "player") return false;
  return t.secret?.[part] ?? SHEET_PARTS.find((p) => p.key === part)!.hiddenByDefault;
}

/** Whether this copy of a character had the part taken out (players' copies of the GM's characters). */
export function withheld(t: Pick<Token, "side" | "secret" | "concealed"> | undefined, part: SheetPart): boolean {
  return !!t?.concealed && isSecret(t, part);
}

/** Keeps only known parts set to true or false. */
export function cleanSecrets(raw: unknown): SheetSecrets {
  const out: SheetSecrets = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw)) if (PARTS.has(k) && typeof v === "boolean") out[k as SheetPart] = v;
  return out;
}

// ---- Log markers ----

const OPEN = "";
const SEP = "";
const BODY = "";
const CLOSE = "";
const MARKER = /([^]*)([a-z]+)([^]*)/g;

/**
 * Log text that tells players about one part of a character, e.g. its Health after a hit. Players'
 * characters have no secrets, so their text is left as it is.
 */
export function secret(t: { id: string; side?: Token["side"] }, part: SheetPart, text: string): string {
  if (!text || t.side === "player") return text;
  return OPEN + t.id + SEP + part + BODY + text.replace(/[-]/g, "") + CLOSE;
}

/** A log line with every secret kept: what the GM reads. */
export function revealLog(line: string): string {
  return line.includes(OPEN) ? line.replace(MARKER, "$3") : line;
}

/** A log line without the secrets `hidden` names, or null when nothing would be left of it. */
export function concealLine(line: string, hidden: (tokenId: string, part: SheetPart) => boolean): string | null {
  if (!line.includes(OPEN)) return line;
  const out = line.replace(MARKER, (_, id: string, part: string, text: string) => (hidden(id, part as SheetPart) ? "" : text));
  return out.trim() ? out : null;
}

// ---- The table players get ----

const RESOURCE_KEYS: Record<"hp" | "stagger" | "light" | "sanity", [keyof Resources, keyof Resources]> = {
  hp: ["hp", "maxHp"],
  stagger: ["stagger", "maxStagger"],
  light: ["light", "maxLight"],
  sanity: ["sanity", "maxSanity"],
};

function concealResources(t: Pick<Token, "side" | "secret">, r: Resources): Resources {
  const out = { ...r };
  for (const [part, keys] of Object.entries(RESOURCE_KEYS)) {
    if (isSecret(t, part as SheetPart)) for (const k of keys) out[k] = 0;
  }
  return out;
}

/** A GM character as players see it: hidden parts are zeroed or left out, and `secret` says which are hidden. */
export function concealToken(t: Token): Token {
  if (t.side === "player") return t;
  const out: Token = { ...t, resources: concealResources(t, t.resources) };
  out.secret = Object.fromEntries(SHEET_PARTS.map((p) => [p.key, isSecret(t, p.key)]));
  out.concealed = true;
  if (isSecret(t, "justice")) delete out.justice;
  if (isSecret(t, "effects")) delete out.effects;
  if (isSecret(t, "resistances")) {
    delete out.resistances;
    delete out.staggerResistances;
  }
  if (isSecret(t, "deck")) {
    delete out.pages;
    delete out.deck;
  }
  if (isSecret(t, "gear")) {
    delete out.gear;
    delete out.passiveEffects;
  }
  // Which rules have fired says which Passives it has.
  delete out.effectUses;
  return out;
}

function concealFxState(tokens: Record<string, Token>, s: FxState | undefined): FxState | undefined {
  if (!s) return s;
  return Object.fromEntries(Object.entries(s).map(([id, v]) => [id, tokens[id] ? { ...v, resources: concealResources(tokens[id], v.resources) } : v]));
}

/**
 * Combat as players see it: draw piles keep their size but not their order, the GM's characters'
 * hands are hidden, and a hidden Deck's Pages are left out until they're played. Speed shows
 * without a hidden Justice in it.
 */
function concealCombat(c: CombatState, tokens: Record<string, Token>): CombatState {
  const hiddenCard = () => ({ id: "hidden", pageId: "hidden" });
  const decks = Object.fromEntries(
    Object.entries(c.decks).map(([id, d]) => {
      const npc = !!tokens[id] && tokens[id].side !== "player";
      return [id, { ...d, draw: d.draw.map(hiddenCard), hand: npc ? d.hand.map(hiddenCard) : d.hand }];
    }),
  );

  // Pages players have seen, or can see now: on a Speed Die, in a discard pile, as Counter Dice, or in a resolution.
  const shown = new Set<string>([
    ...c.slots.map((s) => s.pageId),
    ...Object.values(c.decks).flatMap((d) => [...d.discard, ...(d.auxUsed ?? []), ...(d.egoUsed ?? [])].map((x) => x.pageId)),
    ...Object.values(c.counters).flatMap((list) => list.map((x) => x.pageId)),
    ...(c.fx ?? []).flatMap((f) => [f.pageA, f.pageB ?? ""]),
  ]);
  const secretPages = new Set<string>();
  for (const [id, t] of Object.entries(tokens)) {
    if (!isSecret(t, "deck")) continue;
    for (const p of t.pages ?? []) secretPages.add(p.id);
    const d = c.decks[id];
    if (d) for (const x of [...d.draw, ...d.hand, ...d.aux, ...(d.ego ?? [])]) secretPages.add(x.pageId);
  }
  const pages = Object.fromEntries(Object.entries(c.pages).filter(([id]) => !secretPages.has(id) || shown.has(id)));

  const order = c.order.map((x) => (isSecret(tokens[x.tokenId], "justice") ? { ...x, roll: x.speed, bonus: 0 } : x));
  const fx = c.fx?.map((f): ClashFx => ({
    ...f,
    before: concealFxState(tokens, f.before),
    rounds: f.rounds.map((r) => ({ ...r, after: concealFxState(tokens, r.after) })),
  }));
  const out: CombatState = { ...c, decks, pages, order };
  if (fx) out.fx = fx;
  // An Effect going off on a character whose Effects are secret isn't shown either.
  if (c.procs) out.procs = c.procs.filter((p) => !isSecret(tokens[p.tokenId], "effects"));
  return out;
}

/**
 * The table a player's phone, or the shared board, gets from the host (after `playerView` has taken
 * out what the GM hid on the map): the GM's other maps and map folders aren't sent, and nothing the GM keeps secret
 * about their characters is either.
 */
export function tableForPlayers(full: TableState): TableState {
  // Popups go only to the players they're for (shared/popups.ts), not in the shared table.
  const { maps: _maps, mapFolders: _folders, popups: _popups, ...table } = full;
  const tokens = table.tokens;
  const hidden = (id: string, part: SheetPart) => {
    const t = tokens[id];
    // A character not on this table: say nothing about it.
    return t ? isSecret(t, part) : true;
  };
  const out: TableState = {
    ...table,
    tokens: Object.fromEntries(Object.entries(tokens).map(([id, t]) => [id, concealToken(t)])),
    log: table.log.map((l) => concealLine(l, hidden)).filter((l): l is string => l !== null),
  };
  if (table.combat) out.combat = concealCombat(table.combat, tokens);
  return out;
}

/** The table the GM's own screens get: the log reads normally. */
export function tableForGm(table: TableState): TableState {
  return { ...table, log: table.log.map(revealLog) };
}
