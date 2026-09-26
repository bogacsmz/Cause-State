import { GameState } from '@shared/game/schema'
import { START_COUNTRIES, START_PROVINCES } from './world-seed'

export interface NewGameOptions {
  gameId: string
  playerCountryId?: string
  /** Dice seed; the same seed gives the same game. */
  seed?: number
  startDate?: string
}

/** A fresh world at turn 0: no effects, no history, full political capital. */
export function createNewGame(opts: NewGameOptions): GameState {
  return GameState.parse({
    version: 1,
    gameId: opts.gameId,
    turn: 0,
    date: opts.startDate ?? '2026-01-01',
    playerCountryId: opts.playerCountryId ?? 'TUR',
    politicalCapital: { current: 3, perTurn: 3, max: 6 },
    countries: START_COUNTRIES.map((c) => ({ ...c, bars: { ...c.bars } })),
    provinces: START_PROVINCES.map((p) => ({ ...p })),
    effects: [],
    rng: (opts.seed ?? 20260101) >>> 0,
    counters: { event: 1, effect: 1, seed: 1 }
  })
}
