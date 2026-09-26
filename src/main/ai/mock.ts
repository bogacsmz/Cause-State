import type { AiResult, AiStatus } from '@shared/ipc'
import { abortError, type LlmProvider, type LlmRequest } from './types'

/** Offline stand-in for Claude: deterministic, free, and streams like the real thing. */
export class MockProvider implements LlmProvider {
  readonly id = 'mock' as const

  constructor(private readonly opts: { chunkDelayMs?: number } = {}) {}

  async status(): Promise<AiStatus> {
    return {
      provider: 'mock',
      ready: true,
      label: 'Sahte yapay zeka',
      detail: 'Claude çağrılmıyor, test cevapları üretiliyor.'
    }
  }

  async generate(req: LlmRequest): Promise<AiResult> {
    const started = Date.now()
    const text = mockReply(req.prompt)
    const delay = this.opts.chunkDelayMs ?? 14

    for (const chunk of splitIntoChunks(text, 3)) {
      if (req.signal?.aborted) throw abortError()
      req.onText?.(chunk)
      if (delay > 0) await sleep(delay, req.signal)
    }

    return {
      text,
      model: 'mock',
      usage: { inputTokens: roughTokens(req.system + req.prompt), outputTokens: roughTokens(text) },
      costUsd: 0,
      durationMs: Date.now() - started
    }
  }
}

export function mockReply(prompt: string): string {
  const order = prompt
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?…]+$/, '')
  const quoted = order.length > 140 ? `${order.slice(0, 139)}…` : order
  return (
    `Emriniz kayda geçti: «${quoted}».\n\n` +
    'Bu brifing sahte yapay zekadan geliyor, Claude henüz çağrılmadı. ' +
    'Gerçek danışman bağlandığında emrinizin olası sonuçlarını burada değerlendirecek.'
  )
}

function splitIntoChunks(text: string, size: number): string[] {
  const chars = Array.from(text)
  const chunks: string[] = []
  for (let i = 0; i < chars.length; i += size) chunks.push(chars.slice(i, i + size).join(''))
  return chunks
}

function roughTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(abortError())
      },
      { once: true }
    )
  })
}
