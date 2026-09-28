import { EFFECTS, type EffectId } from '@shared/game/catalog'
import type { Development, SeedOutcome } from '@shared/game/contract'
import { impactDelta, LASTS_TURNS, weightOf, type Impact, type ImpactSize, type Lasts } from '@shared/game/impacts'
import type { EntityRef } from '@shared/game/primitives'
import type { GameState } from '@shared/game/schema'
import { owningCountry } from './lookup'

// How hard something lands on one country, in points: one-off changes plus monthly ones over
// their whole run (positive = good for that country). The director's scale and tone are
// checked against this, so the month's news stays in proportion.

/** A catalog move by `actor` on `target`, as felt by `country`. */
export function moveWeightOn(state: GameState, effectId: EffectId, actor: string, target: EntityRef, country: string): number {
  const def = EFFECTS[effectId]
  const targetCountry = owningCountry(state, target) ?? actor
  const landing = def.modifiers.filter((m) => (m.on === 'actor' ? actor : targetCountry) === country)
  return weightOf(landing, def.durationTurns ?? 6)
}

/** Improvised impacts on `target`, as felt by `country`. */
export function impactsWeightOn(state: GameState, impacts: readonly Impact[], lasts: Lasts, target: EntityRef, country: string): number {
  if ((owningCountry(state, target) ?? target.id) !== country) return 0
  return weightOf(
    impacts.map((i) => ({ delta: impactDelta(i), mode: i.monthly ? 'per_turn' : 'once' })),
    LASTS_TURNS[lasts]
  )
}

/** A whole development, as felt by `country`. */
export function developmentWeightOn(state: GameState, d: Development, country: string): number {
  const actor = d.actor ?? owningCountry(state, d.target) ?? country
  return (
    d.moves.reduce((n, id) => n + moveWeightOn(state, id, actor, d.target, country), 0) +
    impactsWeightOn(state, d.impacts, d.lasts, d.target, country)
  )
}

/** A consequence coming back, as felt by `country`. Impacts land on its target, or the player. */
export function outcomeWeightOn(state: GameState, o: SeedOutcome, country: string): number {
  const target = o.target ?? { type: 'country' as const, id: state.playerCountryId }
  const actor = o.actor ?? owningCountry(state, target) ?? country
  const move = o.effectId && o.target ? moveWeightOn(state, o.effectId, actor, o.target, country) : 0
  return move + impactsWeightOn(state, o.impacts, o.lasts, target, country)
}

/** The same catalog effect in words, so a move too heavy for the month can be told in a smaller size. */
export function effectAsImpacts(effectId: EffectId): { impacts: Impact[]; lasts: Lasts } {
  const def = EFFECTS[effectId]
  const seen = new Set<string>()
  const impacts: Impact[] = []
  for (const m of def.modifiers) {
    if (m.on === 'actor' || seen.has(m.bar)) continue
    seen.add(m.bar)
    const size = Math.abs(m.delta)
    const words: ImpactSize = m.mode === 'per_turn' ? (size <= 1 ? 'small' : size === 2 ? 'clear' : 'large') : size <= 2 ? 'small' : size <= 4 ? 'clear' : 'large'
    impacts.push({ bar: m.bar, change: m.delta > 0 ? 'up' : 'down', size: words, monthly: m.mode === 'per_turn' })
  }
  const turns = def.durationTurns ?? 6
  return { impacts: impacts.slice(0, 3), lasts: turns <= 1 ? 'month' : turns <= 3 ? 'season' : 'half_year' }
}
