import { describe, expect, it } from 'vitest'
import { LIMITS } from '../../src/shared/game/contract'
import { createNewGame } from '../../src/engine/new-game'
import { monthFocus, spotlight } from '../../src/engine/spotlight'

describe('spotlight: who may answer the player abroad (code decides, the AI decides what)', () => {
  it('includes the countries the player’s decisions touch, never the player', () => {
    const state = createNewGame({ gameId: 's', seed: 1 })
    const picks = spotlight(state, [{ target: { type: 'country', id: 'SYR' } }, { target: { type: 'country', id: 'TUR' } }])
    expect(picks).toEqual(['SYR'])
    expect(picks.length).toBeLessThanOrEqual(LIMITS.foreignIntents)
  })

  it('nobody reacts to a month without decisions: the world’s own moves are the director’s', () => {
    for (let turn = 0; turn < 50; turn++) expect(spotlight({ ...createNewGame({ gameId: 'sakin' }), turn }, [])).toEqual([])
  })

  it('the month’s focus adds the country a development starts in', () => {
    const state = createNewGame({ gameId: 's', seed: 1 })
    const touched = [{ target: { type: 'country' as const, id: 'GRC' } }]
    expect(monthFocus(state, touched, { tone: 'opportunity', scale: 'minor', stage: { kind: 'country', id: 'AZE' } })).toEqual(['GRC', 'AZE'])
    expect(monthFocus(state, touched, { tone: 'trouble', scale: 'minor', stage: { kind: 'home' } })).toEqual(['GRC'])
    expect(monthFocus(state, touched, null)).toEqual(['GRC'])
  })
})
