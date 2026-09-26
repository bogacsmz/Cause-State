import { LIMITS } from '@shared/game/contract'
import type { EntityRef } from '@shared/game/primitives'
import type { GameState } from '@shared/game/schema'
import { WORLD_BOOK, type WorldBookEntry } from '@shared/game/world-book'
import { owningCountry } from './lookup'
import { hashRoll } from './rng'

// Who acts abroad this month. The code picks the countries (with keyed dice, so a saved game
// replays the same way); the AI only decides what they do. The same split as the seeds:
// code decides who and when, the AI decides what.

/** Chance each month that one country makes a move on its own agenda. */
export const AGENDA_MOVE_CHANCE = 0.6

/** Tenser relations make a country likelier to be the one that moves. */
const STANCE_WEIGHT: Record<WorldBookEntry['stance'], number> = { hostile: 3, rival: 3, wary: 2, partner: 1.5, ally: 1 }

/**
 * Countries whose move the AI decides this month: those the player's decisions touch
 * (they react), plus, often, one country acting on its own agenda. At most LIMITS.foreignIntents.
 */
export function spotlight(state: GameState, decisions: readonly { target: EntityRef }[]): string[] {
  const turn = state.turn + 1
  const player = state.playerCountryId
  const touched = decisions
    .map((d) => owningCountry(state, d.target))
    .filter((id): id is string => id !== undefined && id !== player && WORLD_BOOK[id] !== undefined)

  const picks = [...new Set(touched)]
  if (hashRoll(`${state.gameId}|agenda|${turn}`) < AGENDA_MOVE_CHANCE) {
    const pool = Object.entries(WORLD_BOOK).filter(([id]) => id !== player && !picks.includes(id))
    const total = pool.reduce((n, [, e]) => n + STANCE_WEIGHT[e.stance], 0)
    let roll = hashRoll(`${state.gameId}|agenda-who|${turn}`) * total
    for (const [id, entry] of pool) {
      roll -= STANCE_WEIGHT[entry.stance]
      if (roll < 0) {
        picks.push(id)
        break
      }
    }
  }
  // An agenda move keeps its place even when many countries were touched.
  return picks.length <= LIMITS.foreignIntents ? picks : [...picks.slice(0, LIMITS.foreignIntents - 1), picks.at(-1)!]
}
