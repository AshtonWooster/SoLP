// The sentence builder for automated effects: every blank is a menu, and the card text is written
// from the picks as you go. See shared/effects.ts for what each piece does at the table.
import { useState } from "react";
import {
  ACTION_OPTIONS,
  AMOUNT_OPTIONS,
  blankAction,
  blankActionFor,
  blankCheck,
  blankRule,
  CHECK_OPTIONS,
  DECAY_OPTIONS,
  describeEffect,
  describeRule,
  EFFECT_KINDS,
  EFFECT_WHENS,
  effectWarnings,
  isAlwaysOn,
  LIMIT_OPTIONS,
  whenOptions,
  WHO_OPTIONS,
  type Action,
  type ActionKind,
  type Amount,
  type Check,
  type CheckKind,
  type EffectDef,
  type EffectKind,
  type Rule,
  type Whose,
} from "../../../shared/effects.ts";
import { tryEffect, type TryResult } from "../../../shared/effects-try.ts";
import { PRIMARY_STATS, SECONDARY_STATS } from "../../../shared/ruleset.ts";
import { NumberInput } from "../Fields.tsx";

const STATS = [...PRIMARY_STATS, ...SECONDARY_STATS].map((s) => ({ value: s.key, label: s.label }));
const STAT_NAMES = Object.fromEntries(STATS.map((s) => [s.value, s.label]));
const DIE_SIZES = [4, 6, 8, 10, 12, 20];

/** The effect's card text, written from its pieces. */
export function effectText(def: EffectDef, library: Record<string, EffectDef>) {
  return describeEffect(def, library, STAT_NAMES);
}

function Select<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <select
      aria-label={label}
      className="piece"
      value={String(value)}
      onChange={(e) => onChange(options.find((o) => String(o.value) === e.target.value)!.value)}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

const dice = DIE_SIZES.map((n) => ({ value: n, label: `d${n}` }));
const WHOSE_OPTIONS: { value: Whose; label: string }[] = [
  { value: "me", label: "my" },
  { value: "them", label: "their" },
];
const WHO_IS: { value: Whose; label: string }[] = [
  { value: "me", label: "I" },
  { value: "them", label: "they" },
];

/** The library's status Effects, for the menus that name one. */
const statusOptions = (library: Record<string, EffectDef>) =>
  Object.entries(library)
    .filter(([, d]) => d.kind === "status")
    .map(([id, d]) => ({ value: id, label: d.name || "Unnamed" }));

/** A small number box inside a sentence. */
function Num({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <span className="piece-num">
      <NumberInput label={label} value={value} min={min} max={max} onChange={(n) => onChange(Math.max(min, Math.min(max, Math.round(n))))} />
    </span>
  );
}

/** Divide, add and cap any amount: "1 per 3 Burn, at most 3". Tucked away; most effects never need it. */
function AmountAdjust({ amount, onChange, label }: { amount: Amount; onChange: (a: Amount) => void; label: string }) {
  const set = (key: "per" | "plus" | "max", n: number, none: number) => {
    const next = { ...amount };
    if (n === none) delete next[key];
    else next[key] = n;
    onChange(next);
  };
  const on = (amount.per ?? 1) > 1 || !!amount.plus || !!amount.max;
  return (
    <details className="piece-adjust" open={on || undefined}>
      <summary aria-label={`${label} adjust`}>±</summary>
      ÷ <Num label={`${label} divided by`} value={amount.per ?? 1} min={1} max={99} onChange={(n) => set("per", n, 1)} /> + <Num label={`${label} plus`} value={amount.plus ?? 0} min={-99} max={99} onChange={(n) => set("plus", n, 0)} /> at most{" "}
      <Num label={`${label} at most`} value={amount.max ?? 0} min={0} max={999} onChange={(n) => set("max", n, 0)} /> <span className="muted small">(0: no limit)</span>
    </details>
  );
}

/** How much: a menu, plus the one number it needs (if any). */
function AmountPicker({ amount, onChange, label, library }: { amount: Amount; onChange: (a: Amount) => void; label: string; library: Record<string, EffectDef> }) {
  const keep = { ...(amount.per ? { per: amount.per } : {}), ...(amount.plus ? { plus: amount.plus } : {}), ...(amount.max ? { max: amount.max } : {}) };
  const set = (kind: Amount["kind"]) => {
    if (kind === "number") onChange({ kind, n: amount.n ?? 1, ...keep });
    else if (kind === "perStack") onChange({ kind, n: 1, ...keep });
    else if (kind === "roll") onChange({ kind, sides: 6, ...keep });
    else if (kind === "rolls") onChange({ kind, sides: 10, ...keep });
    else if (kind === "stat") onChange({ kind, stat: "justice", ...keep });
    else if (kind === "effectStacks") onChange({ kind, n: 1, effectId: "preset:burn", whose: "me", ...keep });
    else onChange({ kind, ...keep });
  };
  const statuses = statusOptions(library);
  return (
    <span className="piece-group">
      {amount.kind === "number" && (
        <span className="piece-num">
          <NumberInput label={`${label} number`} value={amount.n ?? 0} min={0} max={99} onChange={(n) => onChange({ ...amount, n: Math.max(0, Math.min(99, Math.round(n))) })} />
        </span>
      )}
      {amount.kind === "perStack" && (
        <span className="piece-num">
          <NumberInput label={`${label} per stack`} value={amount.n ?? 1} min={1} max={20} onChange={(n) => onChange({ ...amount, n: Math.max(1, Math.min(20, Math.round(n))) })} />
        </span>
      )}
      <Select label={label} value={amount.kind} options={AMOUNT_OPTIONS} onChange={set} />
      {amount.kind === "roll" && <Select label={`${label} die`} value={amount.sides ?? 6} options={dice} onChange={(sides) => onChange({ ...amount, sides })} />}
      {amount.kind === "stat" && <Select label={`${label} Stat`} value={amount.stat ?? "justice"} options={STATS} onChange={(stat) => onChange({ ...amount, stat })} />}
      {amount.kind === "effectStacks" && (
        <>
          {" "}
          <Num label={`${label} times`} value={amount.n ?? 1} min={1} max={20} onChange={(n) => onChange({ ...amount, n })} /> ×{" "}
          <Select label={`${label} whose`} value={amount.whose ?? "me"} options={WHOSE_OPTIONS} onChange={(whose) => onChange({ ...amount, whose })} />{" "}
          <Select label={`${label} Effect`} value={amount.effectId ?? ""} options={statuses} onChange={(effectId) => onChange({ ...amount, effectId })} />
        </>
      )}
      {amount.kind === "rolls" && (
        <>
          <Select label={`${label} die`} value={amount.sides ?? 10} options={dice} onChange={(sides) => onChange({ ...amount, sides })} /> per{" "}
          <Select
            label={`${label} stacks of`}
            value={amount.effectId ? `${amount.whose ?? "me"}:${amount.effectId}` : ""}
            options={[
              { value: "", label: "stack of this" },
              ...statuses.map((o) => ({ value: `me:${o.value}`, label: `${o.label} on me` })),
              ...statuses.map((o) => ({ value: `them:${o.value}`, label: `${o.label} on them` })),
            ]}
            onChange={(v) => {
              const { effectId: _e, whose: _w, ...rest } = amount;
              if (!v) return onChange(rest);
              const [whose, ...id] = v.split(":");
              onChange({ ...rest, whose: whose as Whose, effectId: id.join(":") });
            }}
          />
        </>
      )}
      <AmountAdjust amount={amount} onChange={onChange} label={label} />
    </span>
  );
}

const CMP = [
  { value: "atMost" as const, label: "at most" },
  { value: "atLeast" as const, label: "at least" },
];
const DIE_KINDS = [
  { value: "offensive" as const, label: "Offensive" },
  { value: "defensive" as const, label: "Defensive" },
  { value: "slash" as const, label: "Slash" },
  { value: "pierce" as const, label: "Pierce" },
  { value: "blunt" as const, label: "Blunt" },
  { value: "block" as const, label: "Block" },
  { value: "evade" as const, label: "Evade" },
];

/** One "only if": reads as a sentence with menus for its blanks. */
function CheckPiece({ check, library, onChange, onRemove }: { check: Check; library: Record<string, EffectDef>; onChange: (c: Check) => void; onRemove: () => void }) {
  let body;
  const cmp = <Select label="Check compare" value={check.cmp ?? "atLeast"} options={CMP} onChange={(cmp) => onChange({ ...check, cmp })} />;
  const whose = (options: { value: Whose; label: string }[]) => (
    <Select label="Check whose" value={check.whose ?? "me"} options={options} onChange={(w) => onChange({ ...check, whose: w === "them" ? "them" : undefined })} />
  );
  const statuses = statusOptions(library);
  switch (check.kind) {
    case "effect":
      body = (
        <>
          {whose(WHO_IS)} have {cmp} <Num label="Check stacks" value={check.n ?? 1} min={0} max={99} onChange={(n) => onChange({ ...check, n })} />{" "}
          <Select label="Check Effect" value={check.effectId ?? ""} options={statuses} onChange={(effectId) => onChange({ ...check, effectId })} />{" "}
          <Select label="Check from" value={check.mine ? "mine" : "any"} options={[{ value: "any", label: "from anyone" }, { value: "mine", label: "from me" }]} onChange={(v) => onChange({ ...check, mine: v === "mine" || undefined })} />
        </>
      );
      break;
    case "sanity":
      body = (
        <>
          {whose(WHOSE_OPTIONS)} Sanity is {cmp} <Num label="Sanity" value={check.n ?? 0} min={-99} max={99} onChange={(n) => onChange({ ...check, n })} />
        </>
      );
      break;
    case "state":
      body = (
        <>
          {whose(WHO_IS)}{" "}
          <Select label="Check is" value={check.is === false ? "no" : "yes"} options={[{ value: "yes", label: "am / are" }, { value: "no", label: "am not / aren't" }]} onChange={(v) => onChange({ ...check, is: v === "no" ? false : undefined })} />{" "}
          <Select label="Check state" value={check.state ?? "staggered"} options={[{ value: "staggered" as const, label: "Staggered" }, { value: "panic" as const, label: "Panicking" }]} onChange={(state) => onChange({ ...check, state })} />
        </>
      );
      break;
    case "round":
      body = (
        <>
          the round is {cmp} <Num label="Round" value={check.n ?? 1} min={1} max={99} onChange={(n) => onChange({ ...check, n })} />
        </>
      );
      break;
    case "count":
      body = (
        <>
          {cmp} <Num label="How many" value={check.n ?? 1} min={0} max={20} onChange={(n) => onChange({ ...check, n })} />{" "}
          <Select label="Check side" value={check.side ?? "allies"} options={[{ value: "allies" as const, label: "allies" }, { value: "enemies" as const, label: "enemies" }]} onChange={(side) => onChange({ ...check, side })} />{" "}
          <Select label="Check Knocked Out" value={check.down ? "down" : "up"} options={[{ value: "up", label: "still fighting" }, { value: "down", label: "Knocked Out" }]} onChange={(v) => onChange({ ...check, down: v === "down" || undefined })} />{" "}
          <Select
            label="Check where"
            value={check.range ? "near" : "any"}
            options={[{ value: "any", label: "anywhere" }, { value: "near", label: "within" }]}
            onChange={(v) => {
              const { range: _r, ...rest } = check;
              onChange(v === "near" ? { ...rest, range: 2 } : rest);
            }}
          />
          {check.range ? (
            <>
              {" "}
              <Num label="Check tiles" value={check.range} min={1} max={20} onChange={(range) => onChange({ ...check, range })} /> tiles
            </>
          ) : null}
        </>
      );
      break;
    case "damage":
      body = (
        <>
          it's{" "}
          <Select label="Damage type" value={check.damageType ?? "any"} options={[{ value: "any" as const, label: "any" }, { value: "health" as const, label: "Health" }, { value: "stagger" as const, label: "Stagger" }]} onChange={(damageType) => onChange({ ...check, damageType })} />{" "}
          damage from{" "}
          <Select
            label="Damage source"
            value={check.source === "effect" ? `effect:${check.effectId ?? ""}` : (check.source ?? "any")}
            options={[{ value: "any", label: "anything" }, { value: "attack", label: "an attack" }, { value: "effect:", label: "any Effect" }, ...statuses.map((o) => ({ value: `effect:${o.value}`, label: o.label }))]}
            onChange={(v) => {
              const { effectId: _e, ...rest } = check;
              if (v.startsWith("effect:")) onChange({ ...rest, source: "effect", ...(v.length > 7 ? { effectId: v.slice(7) } : {}) });
              else onChange({ ...rest, source: v as "any" | "attack" });
            }}
          />
        </>
      );
      break;
    case "roll":
      body = (
        <>
          a <Select label="Check die" value={check.sides ?? 10} options={dice} onChange={(sides) => onChange({ ...check, sides })} /> roll is{" "}
          <Select label="Check compare" value={check.cmp ?? "atMost"} options={CMP} onChange={(cmp) => onChange({ ...check, cmp })} />{" "}
          <AmountPicker label="Check amount" library={library} amount={check.amount ?? { kind: "perStack", n: 1 }} onChange={(amount) => onChange({ ...check, amount })} />
        </>
      );
      break;
    case "stacks":
      body = (
        <>
          I have <Select label="Check compare" value={check.cmp ?? "atLeast"} options={CMP} onChange={(cmp) => onChange({ ...check, cmp })} />{" "}
          <span className="piece-num">
            <NumberInput label="Stacks" value={check.n ?? 0} min={0} max={99} onChange={(n) => onChange({ ...check, n: Math.max(0, Math.round(n)) })} />
          </span>{" "}
          stacks
        </>
      );
      break;
    case "health":
      body = (
        <>
          {whose(WHOSE_OPTIONS)} Health is <Select label="Check compare" value={check.cmp ?? "atMost"} options={CMP} onChange={(cmp) => onChange({ ...check, cmp })} />{" "}
          <span className="piece-num">
            <NumberInput label="Health percent" value={check.n ?? 50} min={0} max={100} onChange={(n) => onChange({ ...check, n: Math.max(0, Math.min(100, Math.round(n))) })} />
          </span>
          %
        </>
      );
      break;
    case "die":
      body = (
        <>
          the die is <Select label="Die kind" value={check.dieKind ?? "offensive"} options={DIE_KINDS} onChange={(dieKind) => onChange({ ...check, dieKind })} />
        </>
      );
      break;
  }
  return (
    <div className="piece-row check">
      <span className="piece-tag">if</span>
      <span className="piece-sentence">{body}</span>
      <button type="button" className="icon" aria-label="Remove check" onClick={onRemove}>
        ✕
      </button>
    </div>
  );
}

/** One "do": what happens, to whom, and how much. */
function ActionPiece({
  action,
  rule,
  library,
  isPassive,
  onChange,
  onRemove,
}: {
  action: Action;
  rule: Rule;
  library: Record<string, EffectDef>;
  isPassive: boolean;
  onChange: (a: Action) => void;
  onRemove: () => void;
}) {
  const opt = ACTION_OPTIONS.find((o) => o.value === action.kind)!;
  // Show the actions that fit this When first; the rest still work but warn.
  const options = ACTION_OPTIONS.filter((o) => (!o.only || o.only.includes(rule.when)) && (!isPassive || (o.value !== "gainStacks" && o.value !== "loseStacks")));
  if (!options.includes(opt)) options.push(opt);
  const statuses = statusOptions(library);
  return (
    <div className="piece-row action">
      <span className="piece-tag">do</span>
      <span className="piece-sentence">
        {opt.targets && (
          <>
            <Select label="Who" value={action.target?.who ?? "me"} options={WHO_OPTIONS} onChange={(who) => onChange({ ...action, target: { who, ...(who === "alliesNear" || who === "enemiesNear" ? { range: action.target?.range ?? 2 } : {}) } })} />
            {(action.target?.who === "alliesNear" || action.target?.who === "enemiesNear") && (
              <>
                {" "}within{" "}
                <span className="piece-num">
                  <NumberInput label="Tiles" value={action.target.range ?? 2} min={1} max={20} onChange={(n) => onChange({ ...action, target: { ...action.target!, range: Math.max(1, Math.min(20, Math.round(n))) } })} />
                </span>{" "}
                tiles{" "}
              </>
            )}
          </>
        )}{" "}
        <Select label="Action" value={action.kind} options={options.map((o) => ({ value: o.value, label: o.label }))} onChange={(kind: ActionKind) => onChange({ ...blankAction(kind), ...(ACTION_OPTIONS.find((o) => o.value === kind)!.targets ? { target: action.target ?? { who: "me" } } : {}) })} />{" "}
        {opt.effect && <Select label="Effect given" value={action.effectId ?? ""} options={statuses} onChange={(effectId) => onChange({ ...action, effectId })} />}{" "}
        {!opt.noAmount && <AmountPicker label="Amount" library={library} amount={action.amount} onChange={(amount) => onChange({ ...action, amount })} />}
        {action.kind === "give" && (
          <>
            {" "}
            <Select label="When it arrives" value={action.later ? "later" : "now"} options={[{ value: "now", label: "now" }, { value: "later", label: "next round" }]} onChange={(v) => onChange({ ...action, later: v === "later" || undefined })} />
          </>
        )}
      </span>
      <button type="button" className="icon" aria-label="Remove action" onClick={onRemove}>
        ✕
      </button>
    </div>
  );
}

function RuleCard({
  rule,
  index,
  library,
  kind,
  onChange,
  onRemove,
}: {
  rule: Rule;
  index: number;
  library: Record<string, EffectDef>;
  kind: EffectKind;
  onChange: (r: Rule) => void;
  onRemove: () => void;
}) {
  const whens = whenOptions(kind);
  const isPassive = isAlwaysOn(kind);
  return (
    <section className="rule-card" aria-label={`Rule ${index + 1}`}>
      <div className="piece-row when">
        <span className="piece-tag">when</span>
        <Select
          label="When"
          value={rule.when}
          options={whens.some((o) => o.value === rule.when) ? whens : [...whens, { value: rule.when, label: rule.when, hint: "" }]}
          onChange={(when) => {
            const { effectId: _e, ...rest } = rule;
            onChange(EFFECT_WHENS.includes(when) ? { ...rule, when } : { ...rest, when });
          }}
        />
        {EFFECT_WHENS.includes(rule.when) && (
          <Select
            label="Which Effect"
            value={rule.effectId ?? ""}
            options={[{ value: "", label: "any Effect" }, ...statusOptions(library)]}
            onChange={(effectId) => {
              const { effectId: _e, ...rest } = rule;
              onChange(effectId ? { ...rest, effectId } : rest);
            }}
          />
        )}
        <Select
          label="How often"
          value={rule.limit ?? "always"}
          options={LIMIT_OPTIONS}
          onChange={(limit) => {
            const { limit: _l, ...rest } = rule;
            onChange(limit === "always" ? rest : { ...rest, limit });
          }}
        />
        <span className="muted small">{whens.find((o) => o.value === rule.when)?.hint}</span>
        <button type="button" className="icon" aria-label="Remove rule" onClick={onRemove}>
          ✕
        </button>
      </div>
      {rule.checks.map((c, i) => (
        <CheckPiece key={i} check={c} library={library} onChange={(c2) => onChange({ ...rule, checks: rule.checks.map((x, j) => (j === i ? c2 : x)) })} onRemove={() => onChange({ ...rule, checks: rule.checks.filter((_, j) => j !== i) })} />
      ))}
      {rule.actions.map((a, i) => (
        <ActionPiece
          key={i}
          action={a}
          rule={rule}
          library={library}
          isPassive={isPassive}
          onChange={(a2) => onChange({ ...rule, actions: rule.actions.map((x, j) => (j === i ? a2 : x)) })}
          onRemove={() => onChange({ ...rule, actions: rule.actions.filter((_, j) => j !== i) })}
        />
      ))}
      <div className="row wrap rule-add">
        <select aria-label="Add a check" className="piece add" value="" disabled={rule.checks.length >= 4} onChange={(e) => onChange({ ...rule, checks: [...rule.checks, blankCheck(e.target.value as CheckKind)] })}>
          <option value="">+ Only if…</option>
          {CHECK_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button type="button" className="chip" disabled={rule.actions.length >= 6} onClick={() => onChange({ ...rule, actions: [...rule.actions, blankActionFor(rule.when)] })}>
          + Do something else
        </button>
      </div>
      <p className="rule-read">{describeRule(rule, library, STAT_NAMES, kind)}</p>
    </section>
  );
}

/** Runs the effect on two dummies and shows what happened. */
function TryIt({ def, library }: { def: EffectDef; library: Record<string, EffectDef> }) {
  const [stacks, setStacks] = useState(3);
  const [result, setResult] = useState<TryResult | null>(null);
  return (
    <section className="try-it">
      <div className="row wrap">
        <button type="button" onClick={() => setResult(tryEffect(def, library, stacks))}>
          ▶ Try it
        </button>
        {def.kind === "status" && (
          <label className="inline">
            with{" "}
            <span className="piece-num">
              <NumberInput label="Try with stacks" value={stacks} min={1} max={99} onChange={(n) => setStacks(Math.max(1, Math.min(99, Math.round(n))))} />
            </span>{" "}
            stacks
          </label>
        )}
        <span className="muted small">You and a Dummy trade Strikes (Slash 1d6+2) for a few rounds.</span>
      </div>
      {result && (
        <>
          <p className="small">
            You: {result.you.resources.hp}/{result.you.resources.maxHp} Health · Dummy: {result.dummy.resources.hp}/{result.dummy.resources.maxHp} Health
          </p>
          <ol className="try-log">
            {result.log.map((l, i) => (
              <li key={i} className={/triggers|→|rolls d/.test(l) ? "fx" : ""}>
                {l}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

/**
 * The whole editor for one library entry. Passives and Proficiencies can be plain words (the GM
 * handles them) with rules to automate them; Status and Dice effects are their rules.
 */
export function EffectBuilder({
  def,
  library,
  onChange,
}: {
  def: EffectDef;
  library: Record<string, EffectDef>;
  onChange: (d: EffectDef) => void;
}) {
  const warnings = effectWarnings(def);
  const info = EFFECT_KINDS.find((k) => k.value === def.kind)!;
  const optionalRules = def.kind === "passive" || def.kind === "proficiency";
  const setKind = (kind: EffectKind) => {
    const next: EffectDef = { ...def, kind, decay: kind === "status" ? def.decay : "none" };
    if (kind === "passive") next.cost = def.cost ?? 1;
    else delete next.cost;
    if (kind === "die") next.rules = def.rules.map((r) => (whenOptions("die").some((o) => o.value === r.when) ? r : { ...r, when: "hit" }));
    onChange(next);
  };
  return (
    <div className="effect-builder">
      <div className="row wrap">
        <input className="effect-name" aria-label="Effect name" placeholder={`Name your ${info.label}`} value={def.name} onChange={(e) => onChange({ ...def, name: e.target.value })} />
        <Select label="Kind" value={def.kind} options={EFFECT_KINDS.map((k) => ({ value: k.value, label: k.label }))} onChange={setKind} />
        {def.kind === "passive" && (
          <label className="inline">
            Cost{" "}
            <span className="piece-num">
              <NumberInput label="Passive cost" value={def.cost ?? 1} min={-20} max={20} onChange={(n) => onChange({ ...def, cost: Math.max(-20, Math.min(20, Math.round(n))) })} />
            </span>
          </label>
        )}
      </div>
      <p className="muted small">{info.hint}.</p>

      <div className={`effect-card kind-${def.kind}`} aria-label="Card text">
        <strong>{def.name || "Unnamed"}</strong>
        <span className="muted small">
          {info.label}
          {def.kind === "passive" ? ` · Cost ${def.cost ?? 0}` : ""}
          {optionalRules ? (def.rules.length ? " · Automated" : " · The GM handles it") : ""}
        </span>
        <p>{effectText(def, library) || <span className="muted">Say what it does below.</span>}</p>
      </div>
      {warnings.length > 0 && (
        <ul className="effect-warnings">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {optionalRules && (
        <label className="field">
          <span>What it does</span>
          <textarea placeholder="In words. Add a rule below to automate it." value={def.note ?? ""} onChange={(e) => onChange({ ...def, note: e.target.value })} />
        </label>
      )}

      {optionalRules && <h4 className="rules-head">Automate it {def.rules.length ? "" : <span className="muted small">(optional)</span>}</h4>}
      {def.rules.map((r, i) => (
          <RuleCard
            key={r.id}
            rule={r}
            index={i}
            library={library}
            kind={def.kind}
            onChange={(r2) => onChange({ ...def, rules: def.rules.map((x, j) => (j === i ? r2 : x)) })}
            onRemove={() => onChange({ ...def, rules: def.rules.filter((_, j) => j !== i) })}
          />
        ))}
      <button type="button" disabled={def.rules.length >= 8} onClick={() => onChange({ ...def, rules: [...def.rules, blankRule(def.kind === "die" ? "hit" : "turnEnd")] })}>
        + Add a rule
      </button>

      {def.kind === "status" && (
        <section className="rule-card stacks">
          <div className="piece-row">
            <span className="piece-tag">stacks</span>
            <Select label="Stack behavior" value={def.decay} options={DECAY_OPTIONS} onChange={(decay) => onChange({ ...def, decay })} />
            <label className="inline small">
              Up to{" "}
              <span className="piece-num">
                <NumberInput label="Max stacks" value={def.maxStacks ?? 99} min={1} max={99} onChange={(n) => onChange({ ...def, maxStacks: Math.max(1, Math.min(99, Math.round(n))) })} />
              </span>{" "}
              stacks
            </label>
          </div>
          <div className="piece-row">
            <span className="piece-tag">keeps</span>
            <Select
              label="Keeps another Effect"
              value={def.holds ?? ""}
              options={[{ value: "", label: "Nothing else" }, ...statusOptions(library).map((o) => ({ value: o.value, label: `${o.label} from wearing off` }))]}
              onChange={(holds) => {
                const { holds: _h, ...rest } = def;
                onChange(holds ? { ...rest, holds } : rest);
              }}
            />
            <label className="inline small">
              <input type="checkbox" checked={!!def.bySource} onChange={(e) => onChange({ ...def, bySource: e.target.checked || undefined })} /> Keep each character's stacks apart (Marks)
            </label>
          </div>
        </section>
      )}
      {!optionalRules && (
        <label className="field">
          <span>Note (optional, added to the card text)</span>
          <textarea value={def.note ?? ""} onChange={(e) => onChange({ ...def, note: e.target.value })} />
        </label>
      )}
      {def.rules.length > 0 && <TryIt def={def} library={library} />}
    </div>
  );
}
