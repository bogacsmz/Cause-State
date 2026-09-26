import Anthropic from '@anthropic-ai/sdk'
import type { AiResult, AiStatus, AiUsage } from '@shared/ipc'
import { abortError, LlmError, type LlmProvider, type LlmRequest } from './types'

// USD per million tokens (platform.claude.com pricing). Used only for the cost shown in the UI.
const PRICES: Array<{ prefix: string; input: number; output: number; cacheRead: number }> = [
  { prefix: 'claude-fable-5-1', input: 10, output: 50, cacheRead: 0.25 },
  { prefix: 'claude-opus-5-5', input: 4, output: 20, cacheRead: 0.2 },
  { prefix: 'claude-opus-5', input: 5, output: 25, cacheRead: 0.5 },
  { prefix: 'claude-sonnet-5', input: 2, output: 10, cacheRead: 0.2 },
  { prefix: 'claude-haiku-4-5', input: 1, output: 5, cacheRead: 0.1 }
]

export function estimateCostUsd(model: string, usage: AiUsage): number | undefined {
  const price = PRICES.find((p) => model.startsWith(p.prefix))
  if (!price) return undefined
  const perToken = (usd: number): number => usd / 1_000_000
  return (
    usage.inputTokens * perToken(price.input) +
    usage.outputTokens * perToken(price.output) +
    (usage.cacheReadTokens ?? 0) * perToken(price.cacheRead) +
    (usage.cacheWriteTokens ?? 0) * perToken(price.input * 1.25)
  )
}

/** Calls the Anthropic API directly with the player's own API key. */
export class AnthropicApiProvider implements LlmProvider {
  readonly id = 'api' as const
  private client: Anthropic | undefined

  constructor(private readonly opts: { apiKey?: string; model: string }) {}

  async status(): Promise<AiStatus> {
    if (!this.opts.apiKey) {
      return {
        provider: 'api',
        ready: false,
        label: 'API anahtarı yok',
        detail: 'ANTHROPIC_API_KEY ayarlı değil (.env dosyasına ekle).'
      }
    }
    return { provider: 'api', ready: true, label: 'Claude · API', detail: this.opts.model }
  }

  async generate(req: LlmRequest): Promise<AiResult> {
    if (!this.opts.apiKey) throw new LlmError('API anahtarı ayarlı değil.')
    this.client ??= new Anthropic({ apiKey: this.opts.apiKey })
    const started = Date.now()

    try {
      const stream = this.client.beta.messages.stream(
        {
          model: req.model ?? this.opts.model,
          max_tokens: 64000,
          // The system prompt is the stable part (catalog, rules, world): cache it across turns.
          system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: req.prompt }],
          output_config: {
            effort: req.effort ?? 'low',
            ...(req.schema ? { format: { type: 'json_schema' as const, schema: req.schema } } : {})
          },
          // If a safety classifier declines, the API retries on a fallback model in the same call.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default'
        },
        { signal: req.signal }
      )
      stream.on('text', (delta) => req.onText?.(delta))
      const message = await stream.finalMessage()

      if (message.stop_reason === 'refusal') {
        throw new LlmError('Claude bu isteği yanıtlamayı reddetti.')
      }

      const text = message.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('')
      const usage: AiUsage = {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0
      }
      return {
        text,
        model: message.model,
        usage,
        costUsd: estimateCostUsd(message.model, usage),
        billing: 'api',
        durationMs: Date.now() - started
      }
    } catch (err) {
      throw toLlmError(err)
    }
  }
}

function toLlmError(err: unknown): Error {
  if (err instanceof LlmError) return err
  if (err instanceof Anthropic.APIUserAbortError) return abortError()
  if (err instanceof Anthropic.AuthenticationError) return new LlmError('API anahtarı geçersiz.', { cause: err })
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new LlmError('Bu API anahtarının bu modele erişimi yok.', { cause: err })
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new LlmError('API hız limitine takıldı, biraz bekleyip tekrar dene.', { cause: err })
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new LlmError("Anthropic API'ye bağlanılamadı. İnternet bağlantını kontrol et.", { cause: err })
  }
  if (err instanceof Anthropic.APIError) {
    return new LlmError(`API hatası (${err.status ?? '?'}): ${err.message}`, { cause: err })
  }
  return err instanceof Error ? err : new Error(String(err))
}
