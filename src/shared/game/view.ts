import type { EffectCategory, EffectId } from './catalog'
import type { BarId, EntityRef } from './primitives'
import type { BarCause, Ending, EventKind, TurnReport } from './schema'

// What the UI gets to render the game. Built by the engine from the hard state and the
// event log; the UI never computes rules or numbers itself. Type-only on the UI side:
// every label the screen needs is in here, so the renderer never loads the engine.

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
  categoryLabel: string
  cost: number
  targetKind: 'self' | 'country' | 'province'
  /** For 'self' a single entry: the player's own country. */
  targets: DecisionTarget[]
  /** Can be picked now, given what is already picked this turn. */
  available: boolean
  reason?: string
  /** Already picked for this turn. */
  picked: boolean
  /** What it does, e.g. ["Onay +5", "Ekonomi +1/tur", "3 tur"]. */
  lines: string[]
}

/** A decision picked for the coming turn, not yet carried out. */
export interface PendingView {
  id: string
  effectId: EffectId
  label: string
  /** Empty when the target is the player's own country. */
  targetName: string
  cost: number
  /** The typed order it came from, if any. */
  order: string | null
}

export interface ActiveEffectView {
  id: string
  effectId: EffectId
  label: string
  /** "Senin kararın", a country name, or "Toplum ve piyasalar". */
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

/** A line of conversation with the cabinet. Talking is free; orders become decisions. */
export interface ChatEntry {
  id: string
  /** The turn it was said in (before that turn ended). */
  turn: number
  text: string
  reply: string
  kind: 'action' | 'talk'
  /** Moves added to the month's plan, e.g. "Sınıra yığınak · Suriye". */
  decisions: string[]
  /** Proposals the referee turned down before the final answer, with its reasons. */
  rejected: Array<{ reply: string; reasons: string[] }>
  /** Moves the cabinet talked about, with their real numbers from the catalog. */
  discussed: Array<{ label: string; lines: string[] }>
  /** Set when Claude could not be reached and the scripted rules answered. */
  fallback?: string
}

/** Live progress from the main process while the AI works. */
export type GameProgress =
  | { kind: 'chat'; chatId: string; text: string }
  | { kind: 'reply'; chatId: string; text: string; attempt: number }
  | { kind: 'rejected'; chatId: string; attempt: number; reply: string; reasons: string[] }
  | { kind: 'phase'; phase: 'world' | 'referee' | 'news' }
  | { kind: 'narration'; delta: string }

export interface BarView {
  id: BarId
  label: string
  value: number
  /** Change during the last turn, with its reasons. */
  delta: number
  causes: BarCause[]
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
    bars: BarView[]
    /** `left` = what remains after the decisions already picked this turn. */
    capital: { current: number; max: number; left: number }
    election: {
      turnsLeft: number
      threshold: number
      nextDate: string | null
      last: { turn: number; vote: number; won: boolean } | null
      /** Elections won so far. */
      won: number
    }
    /** Chance of a coup at the current stability, 0–1. */
    coupRisk: number
  }
  options: DecisionOption[]
  pending: PendingView[]
  effects: ActiveEffectView[]
  report: TurnReport | null
  feed: FeedEvent[]
  chat: ChatEntry[]
  /** Approval by turn, for the poll chart. */
  polls: Array<{ turn: number; approval: number }>
  /** Who reads the orders and plays the world, and the last thing to know about it. */
  ai: { kind: 'claude' | 'scripted'; notice: string | null }
}

/** Answer to a typed order or a picked card. */
export interface ActionResult {
  view: GameView
  ok: boolean
  /** The advisor's reply, or why a card could not be picked. */
  message?: string
}
