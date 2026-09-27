import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNewGame } from '../../src/engine/new-game'
import {
  areCountriesAdjacent,
  areProvincesAdjacent,
  borderKm,
  countryNeighbors,
  isOnMap,
  provinceNeighbors
} from '../../src/shared/map/borders'

// The land-border graph (map/adjacency.json from map/adjacency.mjs), checked against the
// real map of the region: it is the groundwork for moving and occupying province by province.

const adjacency = JSON.parse(readFileSync(join(__dirname, '../../map/adjacency.json'), 'utf8')) as {
  countries: Record<string, Record<string, number>>
  provinces: Record<string, Record<string, number>>
}
const places = JSON.parse(readFileSync(join(__dirname, '../../map/places.json'), 'utf8')) as { provinces: Record<string, [string, string]> }
const sorted = (ids: string[]) => [...ids].sort()

describe('province borders', () => {
  it('Hatay borders Aleppo, Idlib and Latakia across the Syrian border, and Adana, Osmaniye, Gaziantep at home', () => {
    expect(sorted(provinceNeighbors('TR-31'))).toEqual(['SY-HL', 'SY-ID', 'SY-LA', 'TR-01', 'TR-27', 'TR-80'])
    expect(areProvincesAdjacent('TR-31', 'SY-ID')).toBe(true)
    expect(areProvincesAdjacent('SY-HL', 'TR-31')).toBe(true)
    expect(areProvincesAdjacent('TR-31', 'TR-06')).toBe(false)
  })

  it('matches the real neighbours of Turkish provinces', () => {
    // Ankara: Bolu, Çankırı, Eskişehir, Kırşehir, Konya, Aksaray, Kırıkkale.
    expect(sorted(provinceNeighbors('TR-06'))).toEqual(['TR-14', 'TR-18', 'TR-26', 'TR-40', 'TR-42', 'TR-68', 'TR-71'])
    // Trabzon: Giresun, Gümüşhane, Rize, Bayburt.
    expect(sorted(provinceNeighbors('TR-61'))).toEqual(['TR-28', 'TR-29', 'TR-53', 'TR-69'])
    // Edirne touches Bulgaria and Greece as well as Thrace.
    expect(sorted(provinceNeighbors('TR-22'))).toEqual(['BG-26', 'BG-28', 'GR-A', 'TR-17', 'TR-39', 'TR-59'])
  })

  it('a strait or the sea is not a land border', () => {
    // İstanbul's two shores are one province; its neighbours are Kırklareli, Kocaeli, Tekirdağ.
    expect(sorted(provinceNeighbors('TR-34'))).toEqual(['TR-39', 'TR-41', 'TR-59'])
    // Crete and Cyprus have no land border with Türkiye.
    expect(provinceNeighbors('GR-M')).toEqual([])
    expect(provinceNeighbors('TR-33').some((id) => id.startsWith('CY'))).toBe(false)
  })
})

describe('country borders', () => {
  it('Türkiye borders exactly its eight neighbours, Cyprus is not one of them', () => {
    expect(sorted(countryNeighbors('TUR'))).toEqual(['ARM', 'AZE', 'BGR', 'GEO', 'GRC', 'IRN', 'IRQ', 'SYR'])
    expect(areCountriesAdjacent('TUR', 'SYR')).toBe(true)
    expect(areCountriesAdjacent('GRC', 'TUR')).toBe(true)
    expect(areCountriesAdjacent('TUR', 'IRN')).toBe(true)
    expect(areCountriesAdjacent('TUR', 'CYP')).toBe(false)
    expect(areCountriesAdjacent('TUR', 'RUS')).toBe(false)
  })

  it('reports the border length in km, longest with Syria', () => {
    const km = Object.fromEntries(countryNeighbors('TUR').map((id) => [id, borderKm('TUR', id)!]))
    expect(Object.entries(km).sort((a, b) => b[1] - a[1])[0]![0]).toBe('SYR')
    expect(km.SYR).toBeGreaterThan(600)
    expect(borderKm('TUR', 'CYP')).toBeNull()
  })
})

describe('the graph as a whole', () => {
  it('is symmetric, with the same length both ways', () => {
    for (const level of ['countries', 'provinces'] as const) {
      for (const [a, neighbours] of Object.entries(adjacency[level])) {
        for (const [b, km] of Object.entries(neighbours)) expect([level, a, b, adjacency[level][b]?.[a]]).toEqual([level, a, b, km])
      }
    }
  })

  it('two provinces touching across a border means their countries border each other', () => {
    const missing: string[] = []
    for (const [a, neighbours] of Object.entries(adjacency.provinces)) {
      for (const b of Object.keys(neighbours)) {
        const ca = places.provinces[a]![0]
        const cb = places.provinces[b]![0]
        if (ca !== cb && !areCountriesAdjacent(ca, cb)) missing.push(`${a}→${b}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('covers every province and country of the game', () => {
    const state = createNewGame({ gameId: 'komsu', seed: 1 })
    for (const c of state.countries) expect(isOnMap(c.id), c.id).toBe(true)
    for (const p of state.provinces) expect(isOnMap(p.id), p.id).toBe(true)
    expect(Object.keys(adjacency.provinces)).toHaveLength(Object.keys(places.provinces).length)
  })

  it('answers no for unknown ids and for a place with itself', () => {
    expect(provinceNeighbors('XX-99')).toEqual([])
    expect(areProvincesAdjacent('TR-31', 'TR-31')).toBe(false)
    expect(areCountriesAdjacent('TUR', 'XXX')).toBe(false)
  })
})
