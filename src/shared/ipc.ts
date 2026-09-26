// Contract between the main process and the UI. Both sides import from here,
// so a channel name or payload shape can only change in one place.

import type { EffectId } from './game/catalog'
import type { EntityRef } from './game/primitives'
import type { ActionResult, GameProgress, GameView } from './game/view'

export const IPC = {
  aiStatus: 'ai:status',
  gameView: 'game:view',
  gameNew: 'game:new',
  gameCommand: 'game:command',
  gamePick: 'game:pick',
  gameUnpick: 'game:unpick',
  gameEndTurn: 'game:end-turn',
  gameProgress: 'game:progress'
} as const

/** Which backend answers AI calls: Claude Code CLI (subscription), API key, or offline mock. */
export type ProviderId = 'cli' | 'api' | 'mock'

export interface AiStatus {
  provider: ProviderId
  ready: boolean
  /** Short label for the status pill, e.g. "Claude · abonelik". */
  label: string
  /** One-line explanation: version, model, or what to fix. */
  detail: string
}

export interface AiUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export interface AiResult {
  text: string
  model?: string
  usage?: AiUsage
  /** Estimated cost in USD (API: computed from usage; CLI: Claude Code's own estimate). */
  costUsd?: number
  /** Who pays: the subscription (cost is only what it would be on the API) or the API key. */
  billing?: 'subscription' | 'api'
  durationMs: number
}

/** The game, run by the main process. Every call returns the fresh view to render. */
export interface GameBridge {
  view: () => Promise<GameView>
  newGame: () => Promise<GameView>
  /** A typed order: a decision for this turn, or a question for the advisor (free). */
  command: (text: string) => Promise<ActionResult>
  pick: (effectId: EffectId, target: EntityRef) => Promise<ActionResult>
  unpick: (pendingId: string) => Promise<GameView>
  endTurn: () => Promise<GameView>
  /** Live progress while the AI works (streamed replies, the news being written). Returns an unsubscribe. */
  onProgress: (listener: (event: GameProgress) => void) => () => void
}

/** What the preload script exposes to the UI as `window.cs`. */
export interface CsBridge {
  platform: string
  ai: {
    /** Whether Claude can be reached, for the status pill. The game talks to Claude through `game`. */
    status: () => Promise<AiStatus>
  }
  game: GameBridge
}
