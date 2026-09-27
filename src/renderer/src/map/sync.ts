import type { Map as MapLibre } from 'maplibre-gl'
import type { MapView } from '@shared/game/view'
import { countryColor } from './colors'

// GameState → the map, through feature-state only: the tiles never reload. Each GameView
// brings a MapView; we work out the state every country and province should have and
// touch only what changed since last time.

type Layer = 'countries' | 'provinces'
type Wanted = Map<string, { layer: Layer; id: string; state: Record<string, unknown> }>

/** The feature-state GameState asks for. Features not listed are drawn from the tiles alone. */
export function wantedStates(game: MapView): Wanted {
  const wanted: Wanted = new Map()
  wanted.set(`countries:${game.player}`, { layer: 'countries', id: game.player, state: { player: true } })
  for (const p of game.provinces) {
    // Coloured only when someone other than the country it lies in holds it.
    const fill = p.controller !== p.home ? countryColor(p.controller, game.player) : null
    const occupied = p.controller !== p.owner
    if (fill || occupied) wanted.set(`provinces:${p.id}`, { layer: 'provinces', id: p.id, state: { fill, occupied } })
  }
  return wanted
}

/** Neutral values for the keys we set; `selected` belongs to the click handler and is left alone. */
const CLEARED: Record<Layer, Record<string, unknown>> = {
  countries: { player: false },
  provinces: { fill: null, occupied: false }
}

/**
 * Applies `wanted` over what was applied before (`applied`, updated in place).
 * Returns how many features changed, for the proof scripts.
 */
export function applyStates(map: MapLibre, wanted: Wanted, applied: Map<string, string>): number {
  let changed = 0
  for (const [key, target] of wanted) {
    const json = JSON.stringify(target.state)
    if (applied.get(key) === json) continue
    map.setFeatureState({ source: 'world', sourceLayer: target.layer, id: target.id }, target.state)
    applied.set(key, json)
    changed++
  }
  for (const key of [...applied.keys()]) {
    if (wanted.has(key)) continue
    const [layer, id] = key.split(':') as [Layer, string]
    map.setFeatureState({ source: 'world', sourceLayer: layer, id }, CLEARED[layer])
    applied.delete(key)
    changed++
  }
  return changed
}

/** Diagonal stripes for occupied provinces: dark lines on transparent. */
export function hatchImage(): { width: number; height: number; data: Uint8Array } {
  const size = 10
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x + y) % size < 3) {
        const o = (y * size + x) * 4
        data[o] = 12
        data[o + 1] = 14
        data[o + 2] = 18
        data[o + 3] = 150
      }
    }
  }
  return { width: size, height: size, data }
}
