import type { z } from 'zod'
import { EFFECTS, targetWeight, type ActorKind, type EffectId, type EffectRule } from '@shared/game/catalog'
import { ChangeList, LIMITS, type ApprovedChangeList, type Development, type ParsedChangeList, type SeedOutcome } from '@shared/game/contract'
import { consequenceFits, fitsTone, SCALE_LIMITS, sizeFits, type Beat, type ConsequenceTone, type Impact, type Scale } from '@shared/game/impacts'
import { entityKey, type EntityRef } from '@shared/game/primitives'
import type { GameState, Seed } from '@shared/game/schema'
import { entityExists, findCountry, findProvince, isEffectActiveOn, owningCountry } from './lookup'
import { developmentWeightOn, effectAsImpacts, moveWeightOn, outcomeWeightOn } from './weight'

// The referee: the only way an LLM proposal becomes an ApprovedChangeList.
// Layer 1 checks shape (zod), layer 2 checks the proposal against the world and the
// rules. Messages are written for the LLM, so a rejected list can be repaired;
// `explainIssue` turns the same issues into Turkish for the player.

export type IssueCode =
  | 'schema'
  | 'unknown_effect'
  | 'extra_field'
  | 'actor_not_allowed'
  | 'wrong_target_type'
  | 'unknown_target'
  | 'unknown_actor'
  | 'actor_is_player'
  | 'rule_failed'
  | 'duplicate'
  | 'already_active'
  | 'over_budget'
  | 'unknown_entity'
  | 'unknown_seed'
  | 'missing_outcome'
  | 'bad_seed_source'
  | 'too_many'
  | 'unplanned'
  | 'too_big'
  | 'wrong_tone'

export interface RefereeIssue {
  path: string
  code: IssueCode
  message: string
  /** The rule that failed, for rule_failed issues. */
  rule?: EffectRule
}

export type RefereeVerdict = { ok: true; changes: ApprovedChangeList } | { ok: false; issues: RefereeIssue[] }

export interface ReviewContext {
  /** Seeds the code decided fire this turn; each needs exactly one outcome. */
  firingSeeds?: readonly Seed[]
  /** The world's own development the code planned this month (none when null or missing). */
  beat?: Beat | null
  /** How big a consequence coming back this month may be (default minor). */
  seedScale?: Scale
  /** The tone it must come back in, when the code rolled one. */
  seedTone?: ConsequenceTone
}

export function reviewChangeList(raw: unknown, state: GameState, ctx: ReviewContext = {}): RefereeVerdict {
  const parsed = ChangeList.safeParse(raw, { reportInput: true })
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map(fromZodIssue) }

  const list = parsed.data
  const issues: RefereeIssue[] = []
  const seen = new Set<string>()
  const player = state.playerCountryId

  let cost = 0
  list.changes.forEach((change, i) => {
    issues.push(...checkAction(state, { ...change, actor: player, kind: 'player' }, `changes[${i}]`, seen))
    cost += EFFECTS[change.effectId].cost
  })
  if (cost > state.politicalCapital.current) {
    issues.push({
      path: 'changes',
      code: 'over_budget',
      message: `these changes cost ${cost} political capital but only ${state.politicalCapital.current} is available this turn; keep the most important ones`
    })
  }

  list.foreignIntents.forEach((intent, i) => {
    const path = `foreignIntents[${i}]`
    const actorIssue = checkForeignActor(state, intent.actor, `${path}.actor`)
    if (actorIssue) issues.push(actorIssue)
    else {
      issues.push(...checkAction(state, { ...intent, kind: 'foreign' }, path, seen))
      const cap = reactionCap(state, list, intent.actor)
      const weight = moveWeightOn(state, intent.effectId, intent.actor, intent.target, player)
      if (Math.abs(weight) > cap) {
        issues.push({
          path,
          code: 'too_big',
          message: `"${intent.effectId}" is too heavy a reaction this month; answer in proportion (a lighter move, or none)`
        })
      }
    }
  })

  const beat = ctx.beat ?? null
  list.developments.forEach((d, i) => issues.push(...checkDevelopment(state, d, beat, `developments[${i}]`, seen)))

  const chosen = new Set(list.changes.map((c) => c.effectId))
  list.newSeeds.forEach((seed, i) => {
    if (seed.source !== null && !chosen.has(seed.source)) {
      issues.push({
        path: `newSeeds[${i}].source`,
        code: 'bad_seed_source',
        message: `source "${seed.source}" is not one of this turn's changes; use one of them or null`
      })
    }
    seed.entities.forEach((ref, j) => {
      if (!entityExists(state, ref)) {
        issues.push({ path: `newSeeds[${i}].entities[${j}]`, code: 'unknown_entity', message: `no ${ref.type} "${ref.id}" in this world` })
      }
    })
    const country = seed.condition?.country
    if (country && !findCountry(state, country)) {
      issues.push({ path: `newSeeds[${i}].condition.country`, code: 'unknown_entity', message: `no country "${country}" in this world` })
    }
  })

  const firing = new Map((ctx.firingSeeds ?? []).map((s) => [s.id, s]))
  const resolved = new Set<string>()
  list.seedOutcomes.forEach((outcome, i) => {
    const path = `seedOutcomes[${i}]`
    if (!firing.has(outcome.seedId)) {
      issues.push({ path: `${path}.seedId`, code: 'unknown_seed', message: `seed "${outcome.seedId}" is not firing this turn` })
      return
    }
    if (resolved.has(outcome.seedId)) {
      issues.push({ path: `${path}.seedId`, code: 'duplicate', message: `seed "${outcome.seedId}" already has an outcome` })
      return
    }
    resolved.add(outcome.seedId)

    const scale = ctx.seedScale ?? 'minor'
    issues.push(...checkImpacts(outcome.impacts, scale, path))
    const weight = outcomeWeightOn(state, outcome, player)
    if (Math.abs(weight) > SCALE_LIMITS[scale].maxWeight) {
      issues.push({ path, code: 'too_big', message: `this consequence is too heavy for this month (it must be ${scale}); make it smaller` })
    }
    if (ctx.seedTone && !consequenceFits(ctx.seedTone, weight)) {
      issues.push({ path, code: 'wrong_tone', message: CONSEQUENCE_MISMATCH[ctx.seedTone] })
    }
    if (outcome.target && !entityExists(state, outcome.target)) {
      issues.push({ path: `${path}.target`, code: 'unknown_target', message: `no ${outcome.target.type} "${outcome.target.id}" in this world` })
      return
    }
    if (outcome.effectId === null || outcome.target === null) {
      if (outcome.effectId !== null) {
        issues.push({ path, code: 'schema', message: 'a catalog effect needs a target; set both, or leave effectId null' })
      }
      return
    }
    if (outcome.actor === null) {
      issues.push(...checkAction(state, { kind: 'world', actor: owningCountry(state, outcome.target) ?? player, effectId: outcome.effectId, target: outcome.target }, path, seen))
    } else {
      const actorIssue = checkForeignActor(state, outcome.actor, `${path}.actor`)
      if (actorIssue) issues.push(actorIssue)
      else issues.push(...checkAction(state, { kind: 'foreign', actor: outcome.actor, effectId: outcome.effectId, target: outcome.target }, path, seen))
    }
  })
  for (const id of firing.keys()) {
    if (!resolved.has(id)) {
      issues.push({ path: 'seedOutcomes', code: 'missing_outcome', message: `seed "${id}" fires this turn and needs exactly one outcome` })
    }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, changes: list as ApprovedChangeList }
}

/**
 * Checks one decision the player is considering, e.g. to grey out a card. `pending` are
 * decisions already picked this turn: they count against the budget and the rules.
 */
export function checkDecision(
  state: GameState,
  effectId: EffectId,
  target: EntityRef,
  pending: ReadonlyArray<{ effectId: EffectId; target: EntityRef }> = []
): RefereeIssue[] {
  const actor = state.playerCountryId
  const seen = new Set<string>()
  for (const p of pending) checkAction(state, { kind: 'player', actor, ...p }, 'pending', seen)
  const issues = checkAction(state, { kind: 'player', actor, effectId, target }, 'decision', seen)
  if (pending.length >= LIMITS.changes) {
    issues.push({ path: 'decision', code: 'too_many', message: `at most ${LIMITS.changes} decisions per turn` })
  }
  const cost = [...pending, { effectId }].reduce((n, d) => n + EFFECTS[d.effectId].cost, 0)
  if (cost > state.politicalCapital.current) {
    issues.push({ path: 'decision', code: 'over_budget', message: `costs ${cost} political capital, ${state.politicalCapital.current} available` })
  }
  return issues
}

/** Turns issues into the feedback message sent back to the LLM for a repair attempt. */
export function formatIssuesForRepair(issues: readonly RefereeIssue[]): string {
  const lines = issues.map((i) => `- ${i.path || '(root)'}: ${i.message}`)
  return [
    'The game referee rejected your ChangeList. Fix every problem below and return the complete corrected ChangeList.',
    'Use only effect ids from the catalog and entities that exist. Never add numbers: the game computes all magnitudes.',
    ...lines
  ].join('\n')
}

/**
 * Keeps a proposal in proportion before the referee reads it: what is only too big is cut
 * down to the month's size instead of being sent back, so a good story is not lost to a
 * repair round. Wrong things (unknown ids, broken rules, the wrong tone) are left for the
 * referee to reject. Pure; returns a new list.
 */
export function fitToPlan(list: ParsedChangeList, state: GameState, ctx: ReviewContext = {}): ParsedChangeList {
  const player = state.playerCountryId
  const beat = ctx.beat ?? null
  const developments = beat
    ? list.developments.slice(0, LIMITS.developments).map((d) => {
        const limits = SCALE_LIMITS[beat.scale]
        const fitted: Development = { ...d, impacts: clipImpacts(d.impacts, beat.scale) }
        const heavy = (x: Development): boolean => Math.abs(developmentWeightOn(state, x, player)) > limits.maxWeight
        while (heavy(fitted) && fitted.impacts.length > 0) fitted.impacts = fitted.impacts.slice(0, -1)
        while (heavy(fitted) && fitted.moves.length > 0) fitted.moves = fitted.moves.slice(0, -1)
        return fitted
      })
    : []

  const scale = ctx.seedScale ?? 'minor'
  const seedOutcomes = list.seedOutcomes.map((o) => {
    const cap = SCALE_LIMITS[scale].maxWeight
    let fitted: SeedOutcome = { ...o, impacts: clipImpacts(o.impacts, scale) }
    if (Math.abs(outcomeWeightOn(state, fitted, player)) > cap && fitted.effectId && fitted.target) {
      // Too heavy a catalog move for this month: tell the same thing in a smaller size.
      const words = effectAsImpacts(fitted.effectId)
      fitted = { ...fitted, effectId: null, impacts: clipImpacts([...words.impacts, ...fitted.impacts], scale), lasts: words.lasts }
    }
    while (Math.abs(outcomeWeightOn(state, fitted, player)) > cap && fitted.impacts.length > 0) {
      fitted = { ...fitted, impacts: fitted.impacts.slice(0, -1) }
    }
    return fitted
  })

  const foreignIntents = list.foreignIntents.filter(
    (f) => Math.abs(moveWeightOn(state, f.effectId, f.actor, f.target, player)) <= reactionCap(state, list, f.actor)
  )
  return { ...list, foreignIntents, seedOutcomes, developments }
}

/** Same words, one bar each, no bigger than the scale allows. */
function clipImpacts(impacts: readonly Impact[], scale: Scale): Impact[] {
  const { largest, largestMonthly } = SCALE_LIMITS[scale]
  const seen = new Set<string>()
  return impacts
    .filter((i) => !seen.has(i.bar) && seen.add(i.bar))
    .map((i) => {
      const max = i.monthly ? largestMonthly : largest
      return sizeFits(i.size, max) ? i : { ...i, size: max }
    })
}

/**
 * How hard another country may hit back this month: in proportion, unless the player's own
 * move against it this month was military or heavy.
 */
function reactionCap(state: GameState, list: Pick<ParsedChangeList, 'changes'>, actor: string): number {
  const provoked = list.changes.some(
    (c) =>
      owningCountry(state, c.target) === actor &&
      (EFFECTS[c.effectId].category === 'military' || Math.abs(targetWeight(c.effectId)) > SCALE_LIMITS.minor.maxWeight)
  )
  return SCALE_LIMITS[provoked ? 'major' : 'minor'].maxWeight
}

function checkImpacts(impacts: readonly Impact[], scale: Scale, path: string): RefereeIssue[] {
  const issues: RefereeIssue[] = []
  const { largest, largestMonthly } = SCALE_LIMITS[scale]
  const bars = new Set<string>()
  impacts.forEach((impact, j) => {
    if (bars.has(impact.bar)) {
      issues.push({ path: `${path}.impacts[${j}]`, code: 'duplicate', message: `"${impact.bar}" appears twice; one impact per bar` })
    }
    bars.add(impact.bar)
    const max = impact.monthly ? largestMonthly : largest
    if (!sizeFits(impact.size, max)) {
      issues.push({ path: `${path}.impacts[${j}].size`, code: 'too_big', message: `a ${scale} development allows ${impact.monthly ? 'monthly ' : ''}impacts up to "${max}"` })
    }
  })
  return issues
}

function checkDevelopment(state: GameState, d: Development, beat: Beat | null, path: string, seen: Set<string>): RefereeIssue[] {
  if (!beat) return [{ path, code: 'unplanned', message: 'no development is planned this month; leave developments empty' }]
  if (d.actor) {
    const actorIssue = checkForeignActor(state, d.actor, `${path}.actor`)
    if (actorIssue) return [actorIssue]
  }
  if (!entityExists(state, d.target)) {
    return [{ path: `${path}.target`, code: 'unknown_target', message: `no ${d.target.type} "${d.target.id}" in this world` }]
  }
  const issues: RefereeIssue[] = []
  const actor = d.actor ?? owningCountry(state, d.target) ?? state.playerCountryId
  d.moves.forEach((effectId, j) => {
    issues.push(...checkAction(state, { kind: d.actor ? 'foreign' : 'world', actor, effectId, target: d.target }, `${path}.moves[${j}]`, seen))
  })
  issues.push(...checkImpacts(d.impacts, beat.scale, path))
  const weight = developmentWeightOn(state, d, state.playerCountryId)
  if (Math.abs(weight) > SCALE_LIMITS[beat.scale].maxWeight) {
    issues.push({ path, code: 'too_big', message: `this development is too heavy for a ${beat.scale} one; use fewer or smaller changes` })
  }
  if (!fitsTone(beat.tone, weight)) {
    issues.push({ path, code: 'wrong_tone', message: TONE_MISMATCH[beat.tone] })
  }
  return issues
}

const CONSEQUENCE_MISMATCH: Record<ConsequenceTone, string> = {
  good: 'this decision comes back as a payoff: on balance it must not cost the player',
  neutral: 'this decision comes back mixed or small: keep its effect on the player small either way, or tell it as a story only',
  trouble: 'this decision comes back as a bill: on balance it must not help the player'
}

const TONE_MISMATCH: Record<Beat['tone'], string> = {
  opportunity: 'this month brings an opportunity: it must not leave the player worse off (an opening, an offer, a door that opens)',
  good: "this month brings good news: on balance it must help the player's country",
  neutral: 'this month brings a neutral development: keep its effect on the player small either way, or make it a story only',
  trouble: "this month brings trouble: on balance it must cost the player's country something"
}

/** The same issue in Turkish, for the player. */
export function explainIssue(issue: RefereeIssue): string {
  switch (issue.code) {
    case 'over_budget':
      return 'Bu tur için siyasi sermaye yetmiyor.'
    case 'already_active':
      return 'Zaten yürürlükte.'
    case 'duplicate':
      return 'Bu tur zaten seçildi.'
    case 'too_many':
      return `Bir turda en fazla ${LIMITS.changes} karar verilebilir.`
    case 'actor_not_allowed':
      return 'Bu hamleyi sen yapamazsın.'
    case 'wrong_target_type':
    case 'unknown_target':
      return 'Hedef uygun değil.'
    case 'rule_failed':
      return issue.rule ? explainRule(issue.rule) : 'Kurallar buna izin vermiyor.'
    default:
      return issue.message
  }
}

function explainRule(rule: EffectRule): string {
  switch (rule.kind) {
    case 'target_is_actor':
      return 'Sadece kendi ülkene uygulanabilir.'
    case 'target_not_actor':
      return 'Başka bir ülkeyi hedeflemeli.'
    case 'province_owned_by_actor':
      return 'Bu il senin değil.'
    case 'requires_active':
      return `Önce "${EFFECTS[rule.effectId].label}" gerekli.`
    case 'forbids_active':
      return `"${EFFECTS[rule.effectId].label}" sürerken yapılamaz.`
    case 'max_active':
      return `Aynı anda en fazla ${rule.count} tane yürürlükte olabilir.`
    case 'military_edge':
      return 'Hedef karşısında yeterli askerî üstünlüğümüz yok.'
  }
}

interface Action {
  kind: ActorKind
  actor: string
  effectId: EffectId
  target: EntityRef
}

function checkForeignActor(state: GameState, actor: string, path: string): RefereeIssue | null {
  if (!findCountry(state, actor)) return { path, code: 'unknown_actor', message: `no country "${actor}" in this world` }
  if (actor === state.playerCountryId) {
    return {
      path,
      code: 'actor_is_player',
      message: "foreign actors must be other countries; put the player's own actions in changes"
    }
  }
  return null
}

function checkAction(state: GameState, a: Action, path: string, seen: Set<string>): RefereeIssue[] {
  const def = EFFECTS[a.effectId]
  const who = { player: 'the player', foreign: 'a foreign country', world: 'society or the world' }[a.kind]
  if (a.effectId === 'improvised') {
    return [{ path: `${path}.effectId`, code: 'unknown_effect', message: 'describe an improvised change with impacts, not with the id "improvised"' }]
  }

  if (!def.actors.includes(a.kind)) {
    return [{ path: `${path}.effectId`, code: 'actor_not_allowed', message: `"${def.id}" cannot be done by ${who}` }]
  }
  if (a.target.type !== def.target) {
    return [
      { path: `${path}.target`, code: 'wrong_target_type', message: `"${def.id}" must target a ${def.target}, not a ${a.target.type}` }
    ]
  }
  if (!entityExists(state, a.target)) {
    return [{ path: `${path}.target`, code: 'unknown_target', message: `no ${a.target.type} "${a.target.id}" in this world` }]
  }

  const issues: RefereeIssue[] = []
  for (const rule of def.rules) {
    const failure = rule.kind === 'max_active' ? checkMaxActive(state, rule.count, a, seen) : checkRule(state, rule, a)
    if (failure) issues.push({ path, code: 'rule_failed', message: `"${def.id}": ${failure}`, rule })
  }

  if (def.unique) {
    const key = `${def.id}|${a.actor}|${entityKey(a.target)}`
    if (seen.has(key)) {
      issues.push({ path, code: 'duplicate', message: `"${def.id}" by ${a.actor} on ${a.target.id} appears twice` })
    } else if (
      state.effects.some((e) => e.effectId === def.id && e.actor === a.actor && entityKey(e.target) === entityKey(a.target))
    ) {
      issues.push({ path, code: 'already_active', message: `"${def.id}" by ${a.actor} on ${a.target.id} is already in effect` })
    }
    seen.add(key)
  }
  return issues
}

/** Copies already running, plus copies picked earlier in this same list. */
function checkMaxActive(state: GameState, count: number, a: Action, seen: ReadonlySet<string>): string | null {
  const running = state.effects.filter((e) => e.effectId === a.effectId && e.actor === a.actor).length
  const prefix = `${a.effectId}|${a.actor}|`
  const picked = [...seen].filter((key) => key.startsWith(prefix)).length
  return running + picked < count ? null : `${a.actor} may have at most ${count} of these running at once`
}

/** Returns why the rule fails, or null if it holds. */
function checkRule(state: GameState, rule: Exclude<EffectRule, { kind: 'max_active' }>, a: Action): string | null {
  const targetCountry = owningCountry(state, a.target)
  switch (rule.kind) {
    case 'target_is_actor':
      return targetCountry === a.actor ? null : `must target the acting country itself (${a.actor})`
    case 'target_not_actor':
      return targetCountry !== a.actor ? null : 'must target another country, not the actor itself'
    case 'province_owned_by_actor':
      return findProvince(state, a.target.id)?.owner === a.actor ? null : `province ${a.target.id} is not owned by ${a.actor}`
    case 'requires_active': {
      const on = rule.on === 'actor' ? a.actor : targetCountry
      return on && isEffectActiveOn(state, rule.effectId, on) ? null : `requires "${rule.effectId}" to be in effect on ${on} first`
    }
    case 'forbids_active': {
      const on = rule.on === 'actor' ? a.actor : targetCountry
      return on && isEffectActiveOn(state, rule.effectId, on) ? `not possible while "${rule.effectId}" is in effect on ${on}` : null
    }
    case 'military_edge': {
      const own = findCountry(state, a.actor)?.bars.military ?? 0
      const theirs = (targetCountry ? findCountry(state, targetCountry)?.bars.military : undefined) ?? 0
      return own - theirs >= rule.margin
        ? null
        : `${a.actor} lacks the clear military edge over ${targetCountry} this needs (its forces are not strong enough)`
    }
  }
}

function fromZodIssue(issue: z.core.$ZodIssue): RefereeIssue {
  const path = issue.path.reduce<string>(
    (acc, part) => (typeof part === 'number' ? `${acc}[${part}]` : acc ? `${acc}.${String(part)}` : String(part)),
    ''
  )
  if (issue.code === 'unrecognized_keys') {
    return {
      path,
      code: 'extra_field',
      message: `unexpected field(s) ${issue.keys.join(', ')}; the schema is closed and numbers are computed by the game, never proposed`
    }
  }
  if (issue.code === 'invalid_value' && path.endsWith('effectId')) {
    return {
      path,
      code: 'unknown_effect',
      message: `unknown effect id ${JSON.stringify(issue.input)}; use an id from the effect catalog`
    }
  }
  return { path, code: 'schema', message: issue.message }
}
