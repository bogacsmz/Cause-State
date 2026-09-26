import { describe, expect, it } from 'vitest'
import { LIMITS } from '../../src/shared/game/contract'
import { createNewGame } from '../../src/engine/new-game'
import { AGENDA_MOVE_CHANCE, spotlight } from '../../src/engine/spotlight'

describe('spotlight: who moves abroad this month (code decides, the AI decides what)', () => {
  it('always includes the countries the player’s decisions touch, never the player', () => {
    const state = createNewGame({ gameId: 's', seed: 1 })
    const picks = spotlight(state, [{ target: { type: 'country', id: 'SYR' } }, { target: { type: 'country', id: 'TUR' } }])
    expect(picks[0]).toBe('SYR')
    expect(picks).not.toContain('TUR')
    expect(picks.length).toBeLessThanOrEqual(LIMITS.foreignIntents)
  })

  it('often brings one country in on its own agenda, the same way on every replay', () => {
    let agenda = 0
    for (let turn = 0; turn < 200; turn++) {
      const state = { ...createNewGame({ gameId: 'agenda' }), turn }
      const picks = spotlight(state, [])
      expect(spotlight(state, [])).toEqual(picks)
      agenda += picks.length
    }
    expect(agenda / 200).toBeGreaterThan(AGENDA_MOVE_CHANCE - 0.15)
    expect(agenda / 200).toBeLessThan(AGENDA_MOVE_CHANCE + 0.15)
  })

  it('keeps the agenda country when many were touched', () => {
    const state = { ...createNewGame({ gameId: 'agenda' }), turn: 0 }
    const withAgenda = [0, 1, 2, 3, 4, 5].map((turn) => ({ ...state, turn })).find((s) => spotlight(s, []).length === 1)!
    const touched = ['GRC', 'SYR', 'IRQ'].map((id) => ({ target: { type: 'country' as const, id } }))
    const picks = spotlight(withAgenda, touched)
    expect(picks).toHaveLength(LIMITS.foreignIntents)
    expect(picks[0]).toBe('GRC')
    // The last place goes to a country acting on its own agenda, not a third touched one.
    expect(['GRC', 'SYR', 'IRQ']).not.toContain(picks.at(-1))
  })
})
