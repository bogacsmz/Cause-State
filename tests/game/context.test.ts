import { describe, expect, it } from 'vitest'
import { LIMITS, TURN_REQUEST_TOKEN_BUDGET } from '../../src/shared/game/contract'
import type { GameEvent, Seed } from '../../src/shared/game/schema'
import { buildTurnRequest, mentionedEntities, turnRequestTokens } from '../../src/engine/context'
import { createNewGame } from '../../src/engine/new-game'

const COUNTRIES = ['TUR', 'GRC', 'USA', 'RUS', 'DEU', 'FRA', 'IRN', 'CHN']

/** A synthetic history: `turns` turns with ten events each and a seed every few turns. */
function history(turns: number): { events: GameEvent[]; seeds: Seed[] } {
  const events: GameEvent[] = []
  const seeds: Seed[] = []
  for (let t = 1; t <= turns; t++) {
    for (let k = 0; k < 10; k++) {
      const other = COUNTRIES[(t + k) % COUNTRIES.length]!
      events.push({
        id: `ev-${String(t * 10 + k).padStart(6, '0')}`,
        turn: t,
        date: '2026-01-01',
        kind: 'effect_applied',
        visibility: k === 9 ? 'hidden' : 'public',
        title: `Tur ${t} olay ${k}: ${other} ile gelişme`,
        summary: 'Uzun bir özet metni. '.repeat(40),
        entities: [
          { type: 'country', id: 'TUR' },
          { type: 'country', id: other }
        ],
        tags: ['diplomasi'],
        causeId: null
      })
    }
    if (t % 3 === 0) {
      seeds.push({
        id: `sd-${String(t).padStart(6, '0')}`,
        plantedTurn: t,
        wakeTurn: t + 10,
        originEventId: `ev-${String(t * 10).padStart(6, '0')}`,
        sourceEffectId: null,
        hook: 'Bu karar ileride geri dönebilir. '.repeat(30),
        entities: [{ type: 'country', id: COUNTRIES[t % COUNTRIES.length]! }],
        tags: ['kelebek'],
        likelihood: 'possible',
        condition: null,
        status: 'dormant',
        firedTurn: null
      })
    }
  }
  return { events, seeds }
}

describe('buildTurnRequest', () => {
  it('stays within the same budget at turn 5 and at turn 500', () => {
    const early = { ...createNewGame({ gameId: 'g' }), turn: 5 }
    const late = { ...createNewGame({ gameId: 'g' }), turn: 500 }
    const small = history(5)
    const huge = history(500)
    const order = "Fransa'ya diplomatik nota ver ve Yunanistan'la ticareti artır."

    const a = buildTurnRequest({ state: early, order, recentEvents: small.events, candidateSeeds: small.seeds })
    const b = buildTurnRequest({ state: late, order, recentEvents: huge.events, candidateSeeds: huge.seeds })

    expect(huge.events).toHaveLength(5000)
    expect(turnRequestTokens(a)).toBeLessThanOrEqual(TURN_REQUEST_TOKEN_BUDGET)
    expect(turnRequestTokens(b)).toBeLessThanOrEqual(TURN_REQUEST_TOKEN_BUDGET)
    expect(b.recentEvents).toHaveLength(LIMITS.recentEvents)
    expect(b.seeds).toHaveLength(LIMITS.relevantSeeds)
  })

  it('keeps hidden events out, newest first, and puts due seeds on top', () => {
    const state = { ...createNewGame({ gameId: 'g' }), turn: 40 }
    const { events, seeds } = history(40)
    const req = buildTurnRequest({ state, order: 'Durum raporu ver.', recentEvents: events, candidateSeeds: seeds })

    expect(req.recentEvents.some((e) => e.title.includes(' olay 9:'))).toBe(false)
    expect(req.recentEvents.map((e) => e.turn)).toEqual([...Array<number>(9).fill(40), ...Array<number>(3).fill(39)])
    expect(req.seeds[0]!.due).toBe(true)
  })

  it('finds countries and provinces named in Turkish, with suffixes', () => {
    const state = createNewGame({ gameId: 'g' })
    const refs = mentionedEntities(state, "Yunanistan'la anlaş, ABD'ye nota ver, İstanbul'a yatırım yap")
    expect(refs).toEqual([
      { type: 'country', id: 'GRC' },
      { type: 'country', id: 'USA' },
      { type: 'province', id: 'TR-34' }
    ])
  })
})
