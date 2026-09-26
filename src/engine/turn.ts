import { EFFECTS, type EffectId } from '@shared/game/catalog'
import type { TurnAction, TurnOutcome } from '@shared/game/contract'
import { countryRef, entityKey, type EntityRef } from '@shared/game/primitives'
import type { ActiveEffect, GameEvent, GameState, Seed } from '@shared/game/schema'
import { entityName, owningCountry } from './lookup'
import { createRng } from './rng'
import { addMonths, formatId, truncate, uniqueTags } from './util'

/** How long a seed sleeps before it may fire, in turns (inclusive range, rolled with the game's dice). */
export const DORMANCY_TURNS = { short: [3, 6], medium: [8, 15], long: [20, 40] } as const
export const MONTHS_PER_TURN = 1

/**
 * Advances the world by one turn. Pure: same state + same action → same outcome.
 *
 * Phase 0.5 does the bookkeeping: the approved changes become active effects with
 * code-computed modifiers, history events and planted seeds; the calendar moves on.
 * Phase 1 adds the tick: bars move by active modifiers, effects expire, political
 * capital refills, due seeds roll to fire, elections resolve.
 */
export function applyTurn(state: GameState, action: TurnAction): TurnOutcome {
  const next = structuredClone(state)
  next.turn += 1
  next.date = addMonths(state.date, MONTHS_PER_TURN)
  const rng = createRng(state.rng)
  const { changes } = action
  const player = next.playerCountryId

  const events: GameEvent[] = []
  const seeds: Seed[] = []
  const record = (partial: Omit<GameEvent, 'id' | 'turn' | 'date'>): GameEvent => {
    const event: GameEvent = { id: formatId('ev', next.counters.event++), turn: next.turn, date: next.date, ...partial }
    events.push(event)
    return event
  }

  const order = record({
    kind: 'order',
    visibility: 'public',
    title: truncate(action.order, 160),
    summary: changes.interpretation,
    entities: dedupe([countryRef(player), ...changes.changes.map((c) => c.target)]),
    tags: ['emir'],
    causeId: null
  })

  const applyEffect = (effectId: EffectId, actor: string, target: EntityRef, source: ActiveEffect['source'], reason: string): void => {
    const def = EFFECTS[effectId]
    const targetCountry = owningCountry(next, target) ?? actor
    const modifiers = def.modifiers.map((m) => ({
      country: m.on === 'actor' ? actor : targetCountry,
      bar: m.bar,
      delta: m.delta,
      mode: m.mode
    }))
    const event = record({
      kind: source === 'player' ? 'effect_applied' : 'foreign_action',
      visibility: 'public',
      title: truncate(`${def.label}: ${entityName(next, target)}`, 160),
      summary: reason,
      entities: dedupe([countryRef(actor), target, ...modifiers.map((m) => countryRef(m.country))]),
      tags: uniqueTags(def.tags),
      causeId: order.id,
      effectId
    })
    next.effects.push({
      id: formatId('fx', next.counters.effect++),
      effectId,
      actor,
      target,
      source,
      appliedTurn: next.turn,
      expiresTurn: def.durationTurns === null ? null : next.turn + def.durationTurns,
      modifiers,
      originEventId: event.id
    })
    if (source === 'player') next.politicalCapital.current = Math.max(0, next.politicalCapital.current - def.cost)
  }

  for (const change of changes.changes) applyEffect(change.effectId, player, change.target, 'player', change.reason)
  for (const intent of changes.foreignIntents) applyEffect(intent.effectId, intent.actor, intent.target, 'foreign', intent.reason)

  for (const proposal of changes.newSeeds) {
    const [min, max] = DORMANCY_TURNS[proposal.dormancy]
    const id = formatId('sd', next.counters.seed++)
    const tags = uniqueTags(proposal.tags)
    record({
      kind: 'seed_planted',
      visibility: 'hidden',
      title: 'Tohum ekildi',
      summary: proposal.hook,
      entities: dedupe(proposal.entities),
      tags,
      causeId: order.id,
      seedId: id
    })
    seeds.push({
      id,
      plantedTurn: next.turn,
      wakeTurn: next.turn + rng.int(min, max),
      originEventId: order.id,
      hook: proposal.hook,
      entities: dedupe(proposal.entities),
      tags,
      likelihood: proposal.likelihood,
      condition: proposal.condition,
      status: 'dormant',
      firedTurn: null
    })
  }

  record({
    kind: 'narration',
    visibility: 'public',
    title: changes.narration.headline,
    summary: changes.narration.body,
    entities: [countryRef(player)],
    tags: [],
    causeId: order.id
  })

  next.rng = rng.state
  return { newState: next, events, seeds, narration: changes.narration }
}

function dedupe(refs: readonly EntityRef[]): EntityRef[] {
  const seen = new Set<string>()
  return refs.filter((r) => {
    const key = entityKey(r)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
