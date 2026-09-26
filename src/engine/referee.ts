import type { z } from 'zod'
import { EFFECTS, type ActorKind, type EffectId, type EffectRule } from '@shared/game/catalog'
import { ChangeList, LIMITS, type ApprovedChangeList } from '@shared/game/contract'
import { entityKey, type EntityRef } from '@shared/game/primitives'
import type { GameState, Seed } from '@shared/game/schema'
import { entityExists, findCountry, findProvince, isEffectActiveOn, owningCountry } from './lookup'

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
    else issues.push(...checkAction(state, { ...intent, kind: 'foreign' }, path, seen))
  })

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

    if (outcome.effectId === null || outcome.target === null) {
      if (outcome.effectId !== outcome.target) {
        issues.push({ path, code: 'schema', message: 'effectId and target must both be set, or both be null for a story-only outcome' })
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
