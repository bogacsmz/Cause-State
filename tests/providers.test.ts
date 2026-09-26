import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AnthropicApiProvider, estimateCostUsd } from '../src/main/ai/anthropic-api'
import { resolveClaude } from '../src/main/ai/find-claude'
import { MockProvider } from '../src/main/ai/mock'
import { isAbortError } from '../src/main/ai/types'
import { DEFAULT_API_MODEL, readAiConfig } from '../src/main/config'

describe('MockProvider', () => {
  it('streams exactly the text it returns', async () => {
    let streamed = ''
    const result = await new MockProvider({ chunkDelayMs: 0 }).generate({
      system: 's',
      prompt: '  Ankara   hazırlansın  ',
      onText: (t) => (streamed += t)
    })
    expect(streamed).toBe(result.text)
    expect(result.text).toContain('«Ankara hazırlansın»')
    expect(result.costUsd).toBe(0)
  })

  it('can be cancelled mid-stream', async () => {
    const controller = new AbortController()
    const run = new MockProvider({ chunkDelayMs: 5 }).generate({
      system: 's',
      prompt: 'p',
      signal: controller.signal,
      onText: () => controller.abort()
    })
    expect(isAbortError(await run.catch((e: unknown) => e))).toBe(true)
  })
})

describe('readAiConfig', () => {
  it('defaults to the subscription CLI', () => {
    expect(readAiConfig({})).toEqual({ provider: 'cli', model: undefined, apiKey: undefined, claudePath: undefined })
  })

  it('reads the API key only for the api provider', () => {
    expect(readAiConfig({ CS_AI_PROVIDER: 'api', ANTHROPIC_API_KEY: ' sk-1 ' }).apiKey).toBe('sk-1')
    expect(readAiConfig({ CS_AI_PROVIDER: 'cli', ANTHROPIC_API_KEY: 'sk-1' }).apiKey).toBeUndefined()
  })

  it('falls back to cli for unknown providers', () => {
    expect(readAiConfig({ CS_AI_PROVIDER: 'gpt' }).provider).toBe('cli')
    expect(readAiConfig({ CS_AI_PROVIDER: ' MOCK ' }).provider).toBe('mock')
  })
})

describe('AnthropicApiProvider', () => {
  it('is not ready without an API key', async () => {
    const status = await new AnthropicApiProvider({ model: DEFAULT_API_MODEL }).status()
    expect(status).toMatchObject({ provider: 'api', ready: false })
  })

  it('estimates cost from usage', () => {
    const cost = estimateCostUsd('claude-opus-5', { inputTokens: 1_000_000, outputTokens: 100_000 })
    expect(cost).toBeCloseTo(5 + 2.5)
    expect(estimateCostUsd('claude-opus-5-5', { inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(4)
    expect(estimateCostUsd('unknown-model', { inputTokens: 1, outputTokens: 1 })).toBeUndefined()
  })
})

describe('resolveClaude', () => {
  const makeFakeClaude = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'cs-bin-'))
    const file = join(dir, 'claude')
    writeFileSync(file, '#!/bin/sh\necho ok\n')
    chmodSync(file, 0o755)
    return dir
  }

  it('finds claude on the login shell PATH even when the app PATH lacks it', async () => {
    const dir = makeFakeClaude()
    const found = await resolveClaude({
      env: { PATH: '/nonexistent' },
      platform: 'linux',
      installDirs: [],
      loginShellPath: async () => dir
    })
    expect(found?.path).toBe(join(dir, 'claude'))
    expect(found?.env.PATH?.split(delimiter)).toContain(dir)
    expect(found?.needsShell).toBe(false)
  })

  it('returns null when claude is nowhere to be found', async () => {
    const found = await resolveClaude({
      env: { PATH: '/nonexistent' },
      platform: 'linux',
      installDirs: [],
      loginShellPath: async () => null
    })
    expect(found).toBeNull()
  })

  it('honours an explicit override path', async () => {
    const dir = makeFakeClaude()
    const found = await resolveClaude({
      override: join(dir, 'claude'),
      env: { PATH: '' },
      platform: 'linux',
      installDirs: [],
      loginShellPath: async () => null
    })
    expect(found?.path).toBe(join(dir, 'claude'))
  })
})
