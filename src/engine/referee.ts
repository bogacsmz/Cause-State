import type { z } from 'zod'
import { EFFECTS, type ActorKind, type EffectId, type EffectRule } from '@shared/game/catalog'
import { ChangeList, type ApprovedChangeList } from '@shared/game/contract'
import { entityKey, type EntityRef } from '@shared/game/primitives'
import type { GameState } from '@shared/game/schema'
import { entityExists, findCountry, findProvince, isEffectActiveOn, owningCountry } from './lookup'

// The referee: the only way an LLM proposal becomes an ApprovedChangeList.
// Layer 1 checks shape (zod), layer 2 checks the proposal against the world and the
// rules. Messages are written for the LLM, so a rejected list can be repaired.

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

export interface RefereeIssue {
  path: string
  code: IssueCode
  message: string
}

export type RefereeVerdict = { ok: true; changes: ApprovedChangeList } | { ok: false; issues: RefereeIssue[] }

export function reviewChangeList(raw: unknown, state: GameState): RefereeVerdict {
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
    if (!findCountry(state, intent.actor)) {
      issues.push({ path: `${path}.actor`, code: 'unknown_actor', message: `no country "${intent.actor}" in this world` })
    } else if (intent.actor === player) {
      issues.push({
        path: `${path}.actor`,
        code: 'actor_is_player',
        message: "foreign intents are for other countries; put the player's own actions in changes"
      })
    } else {
      issues.push(...checkAction(state, { ...intent, kind: 'foreign' }, path, seen))
    }
  })

  list.newSeeds.forEach((seed, i) => {
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

  return issues.length > 0 ? { ok: false, issues } : { ok: true, changes: list as ApprovedChangeList }
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

interface Action {
  kind: ActorKind
  actor: string
  effectId: EffectId
  target: EntityRef
}

function checkAction(state: GameState, a: Action, path: string, seen: Set<string>): RefereeIssue[] {
  const def = EFFECTS[a.effectId]
  const who = a.kind === 'player' ? 'the player' : 'a foreign country'

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
    const failure = checkRule(state, rule, a)
    if (failure) issues.push({ path, code: 'rule_failed', message: `"${def.id}": ${failure}` })
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

/** Returns why the rule fails, or null if it holds. */
function checkRule(state: GameState, rule: EffectRule, a: Action): string | null {
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
