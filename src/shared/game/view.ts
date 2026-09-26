import type { EffectCategory, EffectId } from './catalog'
import type { Bars, EntityRef } from './primitives'
import type { Ending, EventKind, TurnReport } from './schema'

// What the UI gets to render the game. Built by the engine from the hard state and the
// event log; the UI never computes rules or numbers itself.

export interface DecisionTarget {
  ref: EntityRef
  name: string
  available: boolean
  /** Turkish reason when not available. */
  reason?: string
}

export interface DecisionOption {
  effectId: EffectId
  label: string
  summary: string
  category: EffectCategory
  cost: number
  targetKind: 'self' | 'country' | 'province'
  /** For 'self' a single entry: the player's own country. */
  targets: DecisionTarget[]
  available: boolean
  reason?: string
  /** What it does, e.g. ["Onay +5", "Ekonomi +1/tur", "3 tur"]. */
  lines: string[]
}

export interface ActiveEffectView {
  id: string
  effectId: EffectId
  label: string
  /** "Senin kararın", a country name, or "Toplum". */
  source: string
  turnsLeft: number | null
  /** Only what it does to the player's country. */
  lines: string[]
  fromSeed: boolean
}

export interface FeedEvent {
  id: string
  turn: number
  date: string
  kind: EventKind
  title: string
  summary: string
  /** For fired seeds: where it started. `butterfly` = the player's own decision caused it. */
  origin?: { turn: number; label: string; butterfly: boolean }
}

export interface GameView {
  gameId: string
  turn: number
  date: string
  status: 'playing' | 'lost'
  ending: Ending | null
  player: {
    id: string
    name: string
    bars: Bars
    capital: { current: number; max: number }
    election: { turnsLeft: number; threshold: number; nextDate: string | null; last: { turn: number; vote: number; won: boolean } | null }
    /** Chance of a coup at the current stability, 0–1. */
    coupRisk: number
  }
  options: DecisionOption[]
  effects: ActiveEffectView[]
  report: TurnReport | null
  feed: FeedEvent[]
}
