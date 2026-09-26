import { describe, expect, it } from 'vitest'
import { EFFECTS } from '../../src/shared/game/catalog'
import { GameEvent, GameState, Seed } from '../../src/shared/game/schema'
import { createNewGame } from '../../src/engine/new-game'
import { reviewChangeList } from '../../src/engine/referee'
import { applyTurn, DORMANCY_TURNS } from '../../src/engine/turn'
import { normalizeTag } from '../../src/engine/util'
import { ORDER, VALID_CHANGES } from './fixtures'

function approved() {
  const state = createNewGame({ gameId: 'test', seed: 42 })
  const verdict = reviewChangeList(VALID_CHANGES, state)
  if (!verdict.ok) throw new Error('fixture should be valid')
  return { state, changes: verdict.changes }
}

describe('new game', () => {
  it('is a valid GameState with Türkiye as the player', () => {
    const state = createNewGame({ gameId: 'g1' })
    expect(GameState.safeParse(state).success).toBe(true)
    expect(state.playerCountryId).toBe('TUR')
    expect(state.turn).toBe(0)
    expect(state.effects).toEqual([])
  })

  it('refuses a state whose references point nowhere', () => {
    const state = createNewGame({ gameId: 'g1' })
    state.provinces[0]!.owner = 'ATL'
    const result = GameState.safeParse(state)
    expect(result.success).toBe(false)
  })
})

describe('applyTurn', () => {
  it('turns approved changes into effects with numbers taken from the catalog', () => {
    const { state, changes } = approved()
    const { newState } = applyTurn(state, { order: ORDER, changes })

    expect(newState.turn).toBe(1)
    expect(newState.date).toBe('2026-02-01')
    expect(newState.politicalCapital.current).toBe(0)
    expect(GameState.safeParse(newState).success).toBe(true)

    const trade = newState.effects.find((e) => e.effectId === 'trade_agreement')
    expect(trade).toMatchObject({ actor: 'TUR', target: { type: 'country', id: 'GRC' }, source: 'player', expiresTurn: null })
    expect(trade?.modifiers).toEqual([
      { country: 'TUR', bar: 'economy', delta: EFFECTS.trade_agreement.modifiers[0]!.delta, mode: 'per_turn' },
      { country: 'GRC', bar: 'economy', delta: EFFECTS.trade_agreement.modifiers[1]!.delta, mode: 'per_turn' }
    ])

    const protest = newState.effects.find((e) => e.effectId === 'diplomatic_protest')
    expect(protest).toMatchObject({ actor: 'FRA', source: 'foreign', expiresTurn: 2 })
  })

  it('writes a history with a cause chain and a hidden seed', () => {
    const { state, changes } = approved()
    const { events, seeds, narration } = applyTurn(state, { order: ORDER, changes })

    events.forEach((e) => expect(GameEvent.safeParse(e).success).toBe(true))
    const order = events[0]!
    expect(order.kind).toBe('order')
    expect(events.slice(1).every((e) => e.causeId === order.id)).toBe(true)
    expect(events.map((e) => e.kind)).toEqual(['order', 'effect_applied', 'effect_applied', 'foreign_action', 'seed_planted', 'narration'])
    expect(events.find((e) => e.kind === 'seed_planted')?.visibility).toBe('hidden')

    expect(seeds).toHaveLength(1)
    const seed = seeds[0]!
    expect(Seed.safeParse(seed).success).toBe(true)
    expect(seed.tags).toEqual(['ab', 'veto-tehdidi'])
    const [min, max] = DORMANCY_TURNS.medium
    expect(seed.wakeTurn).toBeGreaterThanOrEqual(1 + min)
    expect(seed.wakeTurn).toBeLessThanOrEqual(1 + max)
    expect(narration.headline).toBe(VALID_CHANGES.narration.headline)
  })

  it('is deterministic and never mutates its input', () => {
    const { state, changes } = approved()
    const before = structuredClone(state)
    const a = applyTurn(state, { order: ORDER, changes })
    const b = applyTurn(state, { order: ORDER, changes })
    expect(a).toEqual(b)
    expect(state).toEqual(before)
  })
})

describe('normalizeTag', () => {
  it('makes Turkish free text into stable ASCII tags', () => {
    expect(normalizeTag('Basın Özgürlüğü')).toBe('basin-ozgurlugu')
    expect(normalizeTag('  AB  ')).toBe('ab')
    expect(normalizeTag('!!!')).toBeNull()
  })
})
