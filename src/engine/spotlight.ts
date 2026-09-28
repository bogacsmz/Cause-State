import { LIMITS } from '@shared/game/contract'
import type { Beat } from '@shared/game/impacts'
import type { EntityRef } from '@shared/game/primitives'
import type { GameState } from '@shared/game/schema'
import { WORLD_BOOK } from '@shared/game/world-book'
import { owningCountry } from './lookup'

// Who may answer the player abroad this month: the countries the player's decisions touch.
// They react (or let it pass); what the rest of the world does on its own is the director's
// development (director.ts), not a reaction. Code decides who, the AI decides what.

/** Countries touched by this month's decisions, at most LIMITS.foreignIntents. */
export function spotlight(state: GameState, decisions: readonly { target: EntityRef }[]): string[] {
  const player = state.playerCountryId
  const touched = decisions
    .map((d) => owningCountry(state, d.target))
    .filter((id): id is string => id !== undefined && id !== player && WORLD_BOOK[id] !== undefined)
  return [...new Set(touched)].slice(0, LIMITS.foreignIntents)
}

/** The countries the month is about: those that may react, then the development's country. */
export function monthFocus(state: GameState, decisions: readonly { target: EntityRef }[], beat: Beat | null): string[] {
  const focus = spotlight(state, decisions)
  if (beat?.stage.kind === 'country' && !focus.includes(beat.stage.id)) focus.push(beat.stage.id)
  return focus
}
