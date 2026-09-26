import type { ProviderId } from '@shared/ipc'

/**
 * The game's model. Chosen by a side-by-side run against Sonnet 5 (scripts/model-compare.mts):
 * both proposed valid moves every time; Opus 5.5 answered faster, wrote tighter Turkish news
 * with the origin of each butterfly spelled out, and cost the same per turn.
 */
export const DEFAULT_MODEL = 'claude-opus-5-5'

export interface AiConfig {
  provider: ProviderId
  /** Model override (CS_AI_MODEL); otherwise DEFAULT_MODEL for both the CLI and the API. */
  model?: string
  /** Only read when provider is 'api'; never handed to the CLI. */
  apiKey?: string
  /** Explicit path to the claude executable. */
  claudePath?: string
}

const PROVIDERS: readonly ProviderId[] = ['cli', 'api', 'mock']

/** Reads AI settings from the environment (a .env file in development). */
export function readAiConfig(env: NodeJS.ProcessEnv): AiConfig {
  const raw = (env.CS_AI_PROVIDER ?? '').trim().toLowerCase()
  if (raw && !PROVIDERS.includes(raw as ProviderId)) {
    console.warn(`[config] Bilinmeyen CS_AI_PROVIDER "${raw}", "cli" kullanılıyor.`)
  }
  const provider = PROVIDERS.includes(raw as ProviderId) ? (raw as ProviderId) : 'cli'

  return {
    provider,
    model: env.CS_AI_MODEL?.trim() || undefined,
    apiKey: provider === 'api' ? env.ANTHROPIC_API_KEY?.trim() || undefined : undefined,
    claudePath: env.CS_CLAUDE_PATH?.trim() || undefined
  }
}
