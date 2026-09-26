import type { ProviderId } from '@shared/ipc'

export const DEFAULT_API_MODEL = 'claude-opus-5'

export interface AiConfig {
  provider: ProviderId
  /** Model override. CLI: passed as --model (otherwise Claude Code's default). API: defaults to DEFAULT_API_MODEL. */
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
