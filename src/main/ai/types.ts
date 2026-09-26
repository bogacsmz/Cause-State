import type { AiResult, AiStatus, ProviderId } from '@shared/ipc'

export type Effort = 'low' | 'medium' | 'high'

export interface LlmRequest {
  system: string
  prompt: string
  /**
   * Called with each streamed fragment as it arrives: plain text, or, when `schema` is set,
   * the JSON being written (partial, to be parsed by the caller).
   */
  onText?: (delta: string) => void
  signal?: AbortSignal
  /** JSON Schema the answer must follow; the result's text is then the JSON document. */
  schema?: Record<string, unknown>
  /** How hard the model thinks; lower is faster and cheaper. */
  effort?: Effort
  /** Model for this one call, overriding the provider's setting (used by model comparisons). */
  model?: string
}

/** One way of reaching Claude. The game only ever talks to this interface. */
export interface LlmProvider {
  readonly id: ProviderId
  status(): Promise<AiStatus>
  generate(req: LlmRequest): Promise<AiResult>
}

/** An error whose message is written for the player (Turkish) and can be shown as-is. */
export class LlmError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'LlmError'
  }
}

export function abortError(): Error {
  const err = new Error('İstek iptal edildi.')
  err.name = 'AbortError'
  return err
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}
