import { appendFileSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { AiResult, AiStatus } from '@shared/ipc'
import { abortError, LlmError, type LlmProvider, type LlmRequest } from './types'

// Record real Claude calls once, replay them in tests: the AI path is tested end to end
// without a network, a subscription or an API key, with answers Claude really gave.

export interface RecordedCall {
  /** Which system prompt it was (hash), and the start of the request, for reading the file. */
  system: string
  prompt: string
  schema: boolean
  /** The streamed fragments, in order, so a replay streams like the real call. */
  chunks: string[]
  result: AiResult
}

/** Wraps a real provider and appends every call to a JSON-lines file. */
export class RecordingProvider implements LlmProvider {
  get id(): LlmProvider['id'] {
    return this.inner.id
  }

  constructor(
    private readonly inner: LlmProvider,
    private readonly file: string
  ) {}

  status(): Promise<AiStatus> {
    return this.inner.status()
  }

  async generate(req: LlmRequest): Promise<AiResult> {
    const chunks: string[] = []
    const result = await this.inner.generate({
      ...req,
      onText: (delta) => {
        chunks.push(delta)
        req.onText?.(delta)
      }
    })
    const call: RecordedCall = {
      system: createHash('sha256').update(req.system).digest('hex').slice(0, 12),
      prompt: req.prompt.slice(0, 400),
      schema: req.schema !== undefined,
      chunks,
      result
    }
    appendFileSync(this.file, `${JSON.stringify(call)}\n`)
    return result
  }
}

/** Answers with recorded calls, in order. Runs out loudly, so a test never passes by accident. */
export class ReplayProvider implements LlmProvider {
  readonly id = 'cli' as const
  private next = 0
  readonly requests: LlmRequest[] = []

  constructor(private readonly calls: readonly RecordedCall[]) {}

  static fromFile(file: string): ReplayProvider {
    const calls = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as RecordedCall)
    return new ReplayProvider(calls)
  }

  async status(): Promise<AiStatus> {
    return { provider: 'cli', ready: true, label: 'Kayıttan', detail: `${this.calls.length} kayıtlı çağrı` }
  }

  async generate(req: LlmRequest): Promise<AiResult> {
    if (req.signal?.aborted) throw abortError()
    this.requests.push(req)
    const call = this.calls[this.next++]
    if (!call) throw new LlmError(`kayıtlı çağrı kalmadı (${this.calls.length} kayıt kullanıldı)`)
    for (const chunk of call.chunks) req.onText?.(chunk)
    return call.result
  }

  get used(): number {
    return this.next
  }
}
