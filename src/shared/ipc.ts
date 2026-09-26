// Contract between the main process and the UI. Both sides import from here,
// so a channel name or payload shape can only change in one place.

export const IPC = {
  aiStatus: 'ai:status',
  aiAsk: 'ai:ask',
  aiCancel: 'ai:cancel',
  aiEvent: 'ai:event'
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

export interface AskRequest {
  id: string
  prompt: string
}

export type AiEvent =
  | { id: string; type: 'delta'; text: string }
  | { id: string; type: 'done'; result: AiResult }
  | { id: string; type: 'error'; message: string }

export interface AskHandlers {
  onDelta: (text: string) => void
  onDone: (result: AiResult) => void
  onError: (message: string) => void
}

/** What the preload script exposes to the UI as `window.cs`. */
export interface CsBridge {
  platform: string
  ai: {
    status: () => Promise<AiStatus>
    /** Starts a streamed answer. Returns a function that cancels it. */
    ask: (prompt: string, handlers: AskHandlers) => () => void
  }
}
