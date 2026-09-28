import { GameState } from '@shared/game/schema'
import { addMonths } from './util'
import { START_COUNTRIES, START_PROVINCES } from './world-seed'

export const ELECTION_EVERY_TURNS = 12
export const ELECTION_THRESHOLD = 50
export const CAPITAL_PER_TURN = 3

export interface NewGameOptions {
  gameId: string
  playerCountryId?: string
  /** Dice seed; the same seed gives the same game. */
  seed?: number
  startDate?: string
  /** Months between elections (default ELECTION_EVERY_TURNS). */
  electionEveryTurns?: number
}

/** A fresh world at turn 0: no effects, no history, full political capital, election in a year. */
export function createNewGame(opts: NewGameOptions): GameState {
  const startDate = opts.startDate ?? '2026-01-01'
  const player = opts.playerCountryId ?? 'TUR'
  const every = opts.electionEveryTurns ?? ELECTION_EVERY_TURNS
  return GameState.parse({
    version: 1,
    gameId: opts.gameId,
    turn: 0,
    date: startDate,
    playerCountryId: player,
    status: 'playing',
    ending: null,
    election: { nextTurn: every, everyTurns: every, threshold: ELECTION_THRESHOLD, last: null, won: 0 },
    politicalCapital: { current: CAPITAL_PER_TURN, perTurn: CAPITAL_PER_TURN, max: CAPITAL_PER_TURN },
    countries: START_COUNTRIES.map((c) => ({
      ...c,
      bars: { ...c.bars },
      anchors: { ...c.bars },
      // The player's election follows the game calendar (one turn = one month).
      nextElection: c.id === player ? addMonths(startDate, every) : c.nextElection
    })),
    provinces: START_PROVINCES.map((p) => ({ ...p })),
    effects: [],
    rng: (opts.seed ?? 20260101) >>> 0,
    counters: { event: 1, effect: 1, seed: 1 },
    lastReport: null
  })
}
