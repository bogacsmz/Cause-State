import { DEFAULT_API_MODEL, type AiConfig } from '../config'
import { AnthropicApiProvider } from './anthropic-api'
import { ClaudeCliProvider } from './claude-cli'
import { resolveClaude } from './find-claude'
import { MockProvider } from './mock'
import type { LlmProvider } from './types'

export function createProvider(config: AiConfig, deps: { workDir: string }): LlmProvider {
  switch (config.provider) {
    case 'mock':
      return new MockProvider()
    case 'api':
      return new AnthropicApiProvider({ apiKey: config.apiKey, model: config.model ?? DEFAULT_API_MODEL })
    case 'cli':
      return new ClaudeCliProvider({
        workDir: deps.workDir,
        model: config.model,
        resolveCommand: () => resolveClaude({ override: config.claudePath })
      })
  }
}

export { LlmError, isAbortError, type LlmProvider } from './types'
