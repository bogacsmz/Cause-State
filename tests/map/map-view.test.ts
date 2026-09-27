import type { Map as MapLibre } from 'maplibre-gl'
import { describe, expect, it } from 'vitest'
import type { GameState } from '../../src/shared/game/schema'
import { createNewGame } from '../../src/engine/new-game'
import { buildMapView } from '../../src/main/game/map-view'
import { COUNTRY_PALETTE, countryColor, MAP_COUNTRIES, PLAYER_COLORS } from '../../src/renderer/src/map/colors'
import { applyStates, wantedStates } from '../../src/renderer/src/map/sync'

// The map is a view of GameState: the session builds a MapView from the state, the map
// turns it into feature-state (no tile reload). Here both halves, without a GPU.

const fresh = (): GameState => createNewGame({ gameId: 'harita-3', seed: 3 })

/** Records feature-state calls the way MapLibre would receive them. */
function fakeMap() {
  const calls: Array<{ layer: string; id: string; state: Record<string, unknown> }> = []
  const map = {
    setFeatureState: (f: { sourceLayer: string; id: string }, state: Record<string, unknown>) => calls.push({ layer: f.sourceLayer, id: f.id, state })
  } as unknown as MapLibre
  return { map, calls }
}

describe('the map view of GameState', () => {
  it('names the player, the countries with their bars and stance, and the tracked provinces', () => {
    const view = buildMapView(fresh())
    expect(view.player).toBe('TUR')
    const tur = view.countries.find((c) => c.id === 'TUR')!
    expect(tur).toMatchObject({ name: 'Türkiye', player: true, stance: null })
    expect(tur.bars.map((b) => b.label)).toContain('Ekonomi')
    expect(view.countries.find((c) => c.id === 'SYR')).toMatchObject({ player: false, stance: 'Ortak', regimeLabel: expect.any(String) })
    expect(view.provinces.find((p) => p.id === 'TR-31')).toEqual({
      id: 'TR-31',
      name: 'Hatay',
      home: 'TUR',
      owner: 'TUR',
      ownerName: 'Türkiye',
      controller: 'TUR',
      controllerName: 'Türkiye'
    })
  })

  it('follows a change of owner and holder in the state', () => {
    const state = fresh()
    const hatay = state.provinces.find((p) => p.id === 'TR-31')!
    hatay.owner = 'SYR'
    hatay.controller = 'SYR'
    const antep = state.provinces.find((p) => p.id === 'TR-27')!
    antep.controller = 'SYR'
    const view = buildMapView(state)
    expect(view.provinces.find((p) => p.id === 'TR-31')).toMatchObject({ home: 'TUR', owner: 'SYR', controllerName: 'Suriye' })
    expect(view.provinces.find((p) => p.id === 'TR-27')).toMatchObject({ owner: 'TUR', controller: 'SYR' })
  })

  it('lists what runs between a country and the player', () => {
    const state = fresh()
    state.effects.push({
      id: 'e1',
      effectId: 'trade_agreement',
      actor: 'TUR',
      target: { type: 'country', id: 'SYR' },
      source: 'player',
      seedId: null,
      appliedTurn: 0,
      expiresTurn: 3,
      modifiers: [],
      originEventId: 'ev1'
    })
    expect(buildMapView(state).countries.find((c) => c.id === 'SYR')!.ties).toEqual(['Ticaret anlaşması · 3 ay daha'])
  })
})

describe('GameState → feature-state', () => {
  it('colours the player and every other country from the map palette', () => {
    expect(countryColor('TUR', 'TUR')).toBe(PLAYER_COLORS.fill)
    expect(countryColor('SYR', 'TUR')).toBe(COUNTRY_PALETTE[MAP_COUNTRIES.SYR!.mc - 1])
    // Neighbours never share a hue.
    expect(countryColor('SYR', 'TUR')).not.toBe(countryColor('IRQ', 'TUR'))
  })

  it('a new game marks only the player: nothing else differs from the tiles', () => {
    const wanted = wantedStates(buildMapView(fresh()))
    expect([...wanted.values()]).toEqual([{ layer: 'countries', id: 'TUR', state: { player: true } }])
  })

  it('a province changing hands recolours just that province, and only once', () => {
    const { map, calls } = fakeMap()
    const applied = new Map<string, string>()
    const state = fresh()
    expect(applyStates(map, wantedStates(buildMapView(state)), applied)).toBe(1)

    const hatay = state.provinces.find((p) => p.id === 'TR-31')!
    hatay.owner = 'SYR'
    hatay.controller = 'SYR'
    state.provinces.find((p) => p.id === 'TR-27')!.controller = 'SYR'
    calls.length = 0
    expect(applyStates(map, wantedStates(buildMapView(state)), applied)).toBe(2)
    const syria = countryColor('SYR', 'TUR')
    expect(calls).toHaveLength(2)
    expect(calls).toEqual(
      expect.arrayContaining([
        { layer: 'provinces', id: 'TR-31', state: { fill: syria, occupied: false } },
        { layer: 'provinces', id: 'TR-27', state: { fill: syria, occupied: true } }
      ])
    )

    // Nothing changed: nothing is touched.
    calls.length = 0
    expect(applyStates(map, wantedStates(buildMapView(state)), applied)).toBe(0)

    // Handed back: the state is cleared and the tiles' own colour shows again.
    hatay.owner = hatay.controller = 'TUR'
    expect(applyStates(map, wantedStates(buildMapView(state)), applied)).toBe(1)
    expect(calls).toEqual([{ layer: 'provinces', id: 'TR-31', state: { fill: null, occupied: false } }])
  })
})
