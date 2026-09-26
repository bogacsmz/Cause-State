import type { AiResult, AiStatus, ProviderId } from '@shared/ipc'

export interface LlmRequest {
  system: string
  prompt: string
  /** Called with each streamed text fragment as it arrives. */
  onText?: (delta: string) => void
  signal?: AbortSignal
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
