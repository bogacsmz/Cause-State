import { LIMITS, type SeedPlan } from '@shared/game/contract'
import type { GameState, Seed, SeedCondition } from '@shared/game/schema'
import { findCountry, isEffectActiveOn } from './lookup'
import { hashRoll } from './rng'

// When butterfly seeds wake. The code alone decides when a seed fires; the AI only
// decides what it turns into. Tuned so seeds come back within a 15–20 turn session.

/** How long a seed sleeps before it may fire, in turns (inclusive range, rolled with the game's dice). */
export const DORMANCY_TURNS = { short: [2, 4], medium: [4, 7], long: [8, 14] } as const
/** Chance per turn that an awake seed fires. */
export const FIRE_CHANCE = { unlikely: 0.15, possible: 0.35, likely: 0.6 } as const
/** Turns an awake seed waits for its moment before it fades (so "unlikely" often never comes). */
export const SEED_WINDOW = 3
/** A "low" bar for seed conditions. */
export const LOW_BAR = 35

/**
 * Decides, before the turn is resolved, which due seeds fire and which fade. The roll is
 * keyed by game, seed and turn, so it is reproducible and independent of other dice.
 * `fireFactor` scales every fire chance (the director lowers it right after a busy month).
 */
export function planSeeds(state: GameState, candidates: readonly Seed[], fireFactor = 1): SeedPlan {
  const turn = state.turn + 1
  const firing: Seed[] = []
  const fizzled: Seed[] = []

  const due = candidates
    .filter((s) => s.status === 'dormant' && s.wakeTurn <= turn)
    .sort((a, b) => a.wakeTurn - b.wakeTurn || a.id.localeCompare(b.id))

  for (const seed of due) {
    if (turn > seed.wakeTurn + SEED_WINDOW) {
      fizzled.push(seed)
      continue
    }
    if (firing.length >= LIMITS.firingSeeds) continue
    if (!conditionMet(state, seed.condition)) continue
    if (hashRoll(`${state.gameId}|${seed.id}|${turn}`) < FIRE_CHANCE[seed.likelihood] * fireFactor) firing.push(seed)
  }
  return { firing, fizzled }
}

export function conditionMet(state: GameState, condition: SeedCondition | null): boolean {
  if (!condition) return true
  switch (condition.kind) {
    case 'bar_low':
      return (findCountry(state, condition.country)?.bars[condition.bar] ?? 100) < LOW_BAR
    case 'effect_active':
      return isEffectActiveOn(state, condition.effectId, condition.country)
  }
}
