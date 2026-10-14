// The Proficiency tree: every Proficiency in the game's effect library (kind "proficiency") is a node.
// A node can need other Proficiencies first (its prerequisites) and minimum Primary and Secondary
// Stats. Each player picks proficiencyCount(rank) of them (2 at Rank 9, 2 more each Rank Up).
//
// What a Proficiency does is one of three things, or a mix:
// - automated: it has rules, run by the effect engine like a Passive's (shared/effects.ts);
// - a Page: it adds that Page to its owner's Auxiliary Deck in combat;
// - words only: the GM handles it by hand.
//
// GMs and players add nodes to the shared tree. With the Game setting "Approve changes to the
// Proficiency tree" on, a player's new or changed node is pending until the GM approves it.
import type { Character, Page } from "./character.ts";
import { isLive, type EffectDef } from "./effects.ts";
import { newId } from "./id.ts";
import { PRIMARY_STATS, proficiencyCount, SECONDARY_STATS, type Check } from "./ruleset.ts";

export type ProficiencyMode = "automated" | "page" | "manual";

export const PROFICIENCY_MODES: { value: ProficiencyMode; label: string; hint: string }[] = [
  { value: "automated", label: "Automated", hint: "Rules that run at the table, like a Passive's" },
  { value: "page", label: "Adds a Page", hint: "A Page in its owner's Auxiliary Deck" },
  { value: "manual", label: "Words only", hint: "The GM handles it by hand" },
];

/** What a Proficiency mainly does, for its badge on the tree. */
export function proficiencyMode(def: EffectDef): ProficiencyMode {
  if (def.page) return "page";
  if (def.rules.length) return "automated";
  return "manual";
}

const STAT_LABELS: Record<string, string> = Object.fromEntries([...PRIMARY_STATS, ...SECONDARY_STATS].map((s) => [s.key, s.label]));
export const statLabel = (key: string) => STAT_LABELS[key] ?? key;

/** One node of the tree, with its tier: 0 needs nothing, 1 needs a tier-0 node, and so on. */
export interface TreeNode {
  id: string;
  def: EffectDef;
  tier: number;
  /** Prerequisites that are still in the library. */
  requires: string[];
}

/** Every Proficiency in the library, arranged in tiers by its prerequisites. Loops are cut, not followed. */
export function proficiencyTree(library: Record<string, EffectDef>): TreeNode[] {
  const profs = Object.fromEntries(Object.entries(library).filter(([, d]) => d.kind === "proficiency"));
  const tiers: Record<string, number> = {};
  const tierOf = (id: string, seen: Set<string>): number => {
    if (tiers[id] != null) return tiers[id];
    if (seen.has(id)) return 0;
    seen.add(id);
    const reqs = (profs[id].requires ?? []).filter((r) => profs[r] && r !== id);
    const t = reqs.length ? 1 + Math.max(...reqs.map((r) => tierOf(r, seen))) : 0;
    seen.delete(id);
    return (tiers[id] = t);
  };
  return Object.keys(profs)
    .map((id) => ({ id, def: profs[id], tier: tierOf(id, new Set()), requires: (profs[id].requires ?? []).filter((r) => profs[r] && r !== id) }))
    .sort((a, b) => a.tier - b.tier || a.def.name.localeCompare(b.def.name));
}

/** Whether making `id` need `requires` would make a loop (it, or something after it, already needs `id`). */
export function wouldLoop(library: Record<string, EffectDef>, id: string, requires: string): boolean {
  const seen = new Set<string>();
  const stack = [requires];
  while (stack.length) {
    const at = stack.pop()!;
    if (at === id) return true;
    if (seen.has(at)) continue;
    seen.add(at);
    stack.push(...(library[at]?.requires ?? []));
  }
  return false;
}

/** Whether anyone can pick it: not waiting on the GM. */
export const isPickable = (def: EffectDef | undefined) => !!def && def.kind === "proficiency" && def.pending !== true;

type StatSheet = Pick<Character, "primary" | "secondary">;
const statOf = (c: StatSheet, key: string) => Number((c.primary as Record<string, number>)[key] ?? c.secondary?.[key] ?? 0);

/**
 * What still stands in the way of a character having this Proficiency: prerequisites they haven't
 * picked and Stats too low. Empty: they meet everything. `have` is the library ids they've picked.
 */
export function unmetRequirements(c: StatSheet, def: EffectDef, have: string[], library: Record<string, EffectDef>): string[] {
  const out: string[] = [];
  for (const r of def.requires ?? []) {
    if (!library[r] || have.includes(r)) continue;
    out.push(`Needs ${library[r].name || "an unnamed Proficiency"}`);
  }
  for (const [key, min] of Object.entries(def.minStats ?? {})) {
    if (statOf(c, key) < min) out.push(`Needs ${statLabel(key)} ${min}`);
  }
  return out;
}

/** The library ids of a character's picked Proficiencies. */
export const pickedIds = (c: Pick<Character, "proficiencies">) => (c.proficiencies ?? []).map((p) => p.effectId).filter((id): id is string => !!id);

/** Whether a player can pick this Proficiency now: it's pickable, not taken, with a free pick and every requirement met. */
export function canPick(c: Pick<Character, "primary" | "secondary" | "proficiencies" | "rank">, id: string, library: Record<string, EffectDef>, max = proficiencyCount(c.rank)): { ok: boolean; why: string[] } {
  const def = library[id];
  const have = pickedIds(c);
  if (!isPickable(def)) return { ok: false, why: [def?.pending ? "Waiting for the GM's approval" : "Not in the tree"] };
  if (have.includes(id)) return { ok: false, why: ["Already picked"] };
  const why = unmetRequirements(c, def, have, library);
  if (c.proficiencies.length >= max) why.unshift(`All ${max} picks used`);
  return { ok: why.length === 0, why };
}

/** Picked Proficiencies that other picks still need: taking one away would break them. */
export function neededBy(c: Pick<Character, "proficiencies">, id: string, library: Record<string, EffectDef>): string[] {
  const have = pickedIds(c);
  return have.filter((h) => h !== id && (library[h]?.requires ?? []).includes(id)).map((h) => library[h]?.name || "an unnamed Proficiency");
}

/** Character creator checks: every picked Proficiency's prerequisites and Stats are met. */
export function proficiencyChecks(c: Pick<Character, "primary" | "secondary" | "proficiencies">, library: Record<string, EffectDef> | undefined): Check[] {
  if (!library) return [];
  const have = pickedIds(c);
  return (c.proficiencies ?? []).flatMap((p) => {
    const def = p.effectId ? library[p.effectId] : undefined;
    if (!def) return [];
    return unmetRequirements(c, def, have, library).map((why) => ({ step: "Proficiencies", ok: false, text: `${def.name || "A Proficiency"}: ${why.toLowerCase()}` }));
  });
}

/**
 * The Pages a character's Proficiencies add to their Auxiliary Deck, one copy each. A player's
 * Proficiency must be approved (like any automated effect) before its Page reaches the table.
 */
export function proficiencyPages(c: Pick<Character, "proficiencies">, library: Record<string, EffectDef> | undefined): { proficiencyId: string; page: Page }[] {
  if (!library) return [];
  return (c.proficiencies ?? []).flatMap((p) => {
    const def = p.effectId ? library[p.effectId] : undefined;
    return def?.page && isLive(def) ? [{ proficiencyId: p.id, page: def.page }] : [];
  });
}

// ---- Filtering by required Stats ----

/** How a Stat requirement is compared: needs it at all, or needs at least, exactly or at most N. */
export type StatCmp = "any" | "atLeast" | "exactly" | "atMost";

export const STAT_CMP_OPTIONS: { value: StatCmp; label: string }[] = [
  { value: "any", label: "any amount" },
  { value: "atLeast", label: "at least" },
  { value: "exactly", label: "exactly" },
  { value: "atMost", label: "at most" },
];

/** One line of the filter: "needs Fortitude at least 2". */
export interface StatFilterRow {
  stat: string;
  cmp: StatCmp;
  n: number;
}

/** Proficiencies whose Stat requirements match every line ("and") or any line ("or"). */
export interface StatFilter {
  rows: StatFilterRow[];
  mode: "and" | "or";
}

export const emptyStatFilter = (): StatFilter => ({ rows: [], mode: "and" });

/** Whether a Proficiency's own Stat requirement fits one line of the filter. No requirement for that Stat never fits. */
export function matchesStatRow(def: EffectDef, row: StatFilterRow): boolean {
  const need = def.minStats?.[row.stat];
  if (!need) return false;
  switch (row.cmp) {
    case "any":
      return true;
    case "atLeast":
      return need >= row.n;
    case "exactly":
      return need === row.n;
    case "atMost":
      return need <= row.n;
  }
}

/** Whether a Proficiency passes the filter. An empty filter lets everything through. */
export function matchesStatFilter(def: EffectDef, filter: StatFilter | undefined): boolean {
  if (!filter?.rows.length) return true;
  return filter.mode === "or" ? filter.rows.some((r) => matchesStatRow(def, r)) : filter.rows.every((r) => matchesStatRow(def, r));
}

/** "Needs Fortitude at least 2 and Insight": the filter in words. */
export function statFilterText(filter: StatFilter): string {
  const rows = filter.rows.map((r) => `${statLabel(r.stat)}${r.cmp === "any" ? "" : ` ${STAT_CMP_OPTIONS.find((o) => o.value === r.cmp)!.label} ${r.n}`}`);
  return rows.length ? `Needs ${rows.join(filter.mode === "or" ? " or " : " and ")}` : "";
}

// ---- Placeholder tree ----

const prof = (name: string, note: string, extra: Partial<EffectDef> = {}): EffectDef => ({ name, kind: "proficiency", note, decay: "none", rules: [], ...extra });

/**
 * A starter tree the GM can add to a game in one go, to change or delete: three short branches
 * (combat, workshop, perception), each with a node that needs Stats and one that adds a Page.
 * Keys are stand-ins for library ids; placeholderTree swaps in real ones.
 */
export const PLACEHOLDER_TREE: Record<string, EffectDef> = {
  drills: prof("Combat Drills", "Placeholder. Trained in the basics of fighting in a Fixer office."),
  bladework: prof("Bladework", "Placeholder. +1 Power on Slash dice.", {
    requires: ["drills"],
    minStats: { justice: 2 },
    rules: [{ id: "r1", when: "roll", checks: [{ kind: "die", dieKind: "slash" }], actions: [{ kind: "addPower", amount: { kind: "number", n: 1 } }] }],
  }),
  guard: prof("Guard Stance", "Placeholder. +1 Power on Block dice.", {
    requires: ["drills"],
    minStats: { fortitude: 2 },
    rules: [{ id: "r1", when: "roll", checks: [{ kind: "die", dieKind: "block" }], actions: [{ kind: "addPower", amount: { kind: "number", n: 1 } }] }],
  }),
  flurry: prof("Flurry", "Placeholder. Adds the Flurry Page to your Auxiliary Deck.", {
    requires: ["bladework"],
    minStats: { justice: 3 },
    page: { id: "flurry", name: "Flurry", kind: "basic", cost: 1, type: "melee", effect: "Placeholder Page from the Flurry Proficiency.", dice: [
      { id: "f1", kind: "slash", counter: false, sides: 4, basePower: 1 },
      { id: "f2", kind: "slash", counter: false, sides: 4, basePower: 1 },
    ] },
  }),
  tinkering: prof("Tinkering", "Placeholder. You can repair and adjust gear between scenes."),
  modding: prof("Weapon Modding", "Placeholder. Modify weapons in a workshop. The GM decides what each mod does.", { requires: ["tinkering"], minStats: { prudence: 2 } }),
  fieldKit: prof("Field Kit", "Placeholder. Adds the Patch Up Page to your Auxiliary Deck.", {
    requires: ["tinkering"],
    minStats: { temperance: 2 },
    page: { id: "patchup", name: "Patch Up", kind: "basic", cost: 1, type: "instant", effect: "Placeholder: recover 1d4 Health.", dice: [] },
  }),
  streetwise: prof("Streetwise", "Placeholder. You know the Backstreets: who to ask and where not to go."),
  keenEye: prof("Keen Eye", "Placeholder. Perception Story Rolls get +1.", { requires: ["streetwise"], minStats: { insight: 2 } }),
  master: prof("Seasoned Fixer", "Placeholder. A capstone: needs one Proficiency from each branch.", {
    requires: ["bladework", "modding", "keenEye"],
    minStats: { justice: 3, prudence: 3 },
  }),
};

/** The placeholder tree with new library ids, prerequisites (and Page ids) pointing at them. */
export function placeholderTree(makeId: () => string = newId): Record<string, EffectDef> {
  const ids = Object.fromEntries(Object.keys(PLACEHOLDER_TREE).map((k) => [k, makeId()]));
  return Object.fromEntries(
    Object.entries(PLACEHOLDER_TREE).map(([k, d]) => {
      const def: EffectDef = structuredClone(d);
      if (def.requires) def.requires = def.requires.map((r) => ids[r]);
      if (def.page) def.page = { ...def.page, id: newId(), dice: def.page.dice.map((x) => ({ ...x, id: newId() })) };
      return [ids[k], def];
    }),
  );
}
