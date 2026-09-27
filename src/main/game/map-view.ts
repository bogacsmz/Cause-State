import { EFFECTS } from '@shared/game/catalog'
import { BAR_IDS, BAR_LABELS } from '@shared/game/primitives'
import type { GameState, Regime } from '@shared/game/schema'
import type { MapView } from '@shared/game/view'
import { WORLD_BOOK, type WorldBookEntry } from '@shared/game/world-book'
import placesJson from '../../../map/places.json'

// The map is a view of GameState: this reads the state and never changes it.

const REGIME_LABELS: Record<Regime, string> = { democracy: 'Demokrasi', hybrid: 'Karma rejim', authoritarian: 'Otoriter rejim' }
const STANCE_LABELS: Record<WorldBookEntry['stance'], string> = {
  ally: 'Müttefik',
  partner: 'Ortak',
  wary: 'Temkinli',
  rival: 'Rakip',
  hostile: 'Düşmanca'
}

/** The map's ids and names (map/places.json, written by the map build). */
const places = placesJson as unknown as { countries: Record<string, string>; provinces: Record<string, [string, string]> }
const provinceHome = (id: string): string | undefined => places.provinces[id]?.[0]

export function buildMapView(state: GameState): MapView {
  const player = state.playerCountryId
  const name = (id: string): string =>
    state.countries.find((c) => c.id === id)?.name ?? places.countries[id] ?? id

  const ties = (id: string): string[] =>
    state.effects
      .filter((e) => e.source !== 'world' && ((e.actor === id && e.target.id === player) || (e.actor === player && e.target.id === id)))
      .map((e) => {
        const left = e.expiresTurn === null ? 'kalıcı' : `${e.expiresTurn - state.turn} ay daha`
        return `${EFFECTS[e.effectId].label}${e.actor === player ? '' : ` (${name(e.actor)})`} · ${left}`
      })

  return {
    player,
    countries: state.countries.map((c) => ({
      id: c.id,
      name: c.name,
      player: c.id === player,
      regimeLabel: REGIME_LABELS[c.regime],
      bars: BAR_IDS.map((id) => ({ id, label: BAR_LABELS[id], value: c.bars[id] })),
      stance: c.id === player ? null : WORLD_BOOK[c.id] ? STANCE_LABELS[WORLD_BOOK[c.id]!.stance] : null,
      ties: c.id === player ? [] : ties(c.id)
    })),
    provinces: state.provinces.map((p) => ({
      id: p.id,
      name: p.name,
      home: provinceHome(p.id) ?? p.owner,
      owner: p.owner,
      ownerName: name(p.owner),
      controller: p.controller,
      controllerName: name(p.controller)
    }))
  }
}
