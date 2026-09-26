import type { EffectId } from '@shared/game/catalog'
import type { EntityRef } from '@shared/game/primitives'
import type { Country, GameState, Province } from '@shared/game/schema'

export function findCountry(state: GameState, id: string): Country | undefined {
  return state.countries.find((c) => c.id === id)
}

export function findProvince(state: GameState, id: string): Province | undefined {
  return state.provinces.find((p) => p.id === id)
}

export function entityExists(state: GameState, ref: EntityRef): boolean {
  return ref.type === 'country' ? findCountry(state, ref.id) !== undefined : findProvince(state, ref.id) !== undefined
}

/** The country an entity belongs to: itself, or a province's owner. */
export function owningCountry(state: GameState, ref: EntityRef): string | undefined {
  return ref.type === 'country' ? ref.id : findProvince(state, ref.id)?.owner
}

/** Whether an effect with this id currently targets the given country. */
export function isEffectActiveOn(state: GameState, effectId: EffectId, countryId: string): boolean {
  return state.effects.some((e) => e.effectId === effectId && e.target.type === 'country' && e.target.id === countryId)
}

/** Display name for an entity, falling back to its id. */
export function entityName(state: GameState, ref: EntityRef): string {
  return (ref.type === 'country' ? findCountry(state, ref.id)?.name : findProvince(state, ref.id)?.name) ?? ref.id
}
