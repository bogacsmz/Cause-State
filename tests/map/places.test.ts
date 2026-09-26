import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNewGame } from '../../src/engine/new-game'

// The map is a view of GameState: every country and province the game knows must exist on
// the map under the same id, in the same country. map/places.json comes from `npm run map:build`.
const places = JSON.parse(readFileSync(join(__dirname, '../../map/places.json'), 'utf8')) as {
  countries: Record<string, string>
  provinces: Record<string, [string, string]>
}
const state = createNewGame({ gameId: 'harita', seed: 1 })

describe('map ids', () => {
  it('has every country of the game', () => {
    const missing = state.countries.map((c) => c.id).filter((id) => !(id in places.countries))
    expect(missing).toEqual([])
    expect(places.countries.TUR).toBe('Türkiye')
  })

  it('has every province of the game, in its owner country', () => {
    const wrong = state.provinces.filter((p) => places.provinces[p.id]?.[0] !== p.owner)
    expect(wrong.map((p) => p.id)).toEqual([])
    expect(places.provinces['TR-31']).toEqual(['TUR', 'Hatay'])
  })

  it('covers the world at province level only: 81 Turkish provinces, no districts', () => {
    const turkish = Object.values(places.provinces).filter(([country]) => country === 'TUR')
    expect(turkish).toHaveLength(81)
    expect(Object.keys(places.provinces).length).toBeLessThan(5000)
  })
})
