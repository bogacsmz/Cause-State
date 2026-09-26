import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCliArgs, ClaudeCliProvider, explainCliFailure, subscriptionEnv } from '../src/main/ai/claude-cli'
import { isAbortError, LlmError } from '../src/main/ai/types'

const FAKE = resolve(__dirname, 'fixtures/fake-claude.mjs')

function provider(mode: string, extraEnv: NodeJS.ProcessEnv = {}, model?: string): ClaudeCliProvider {
  return new ClaudeCliProvider({
    workDir: mkdtempSync(join(tmpdir(), 'cs-test-')),
    model,
    resolveCommand: async () => ({
      path: FAKE,
      env: { ...process.env, FAKE_CLAUDE_MODE: mode, ...extraEnv },
      needsShell: false
    })
  })
}

describe('ClaudeCliProvider', () => {
  it('streams text deltas and returns the final result', async () => {
    const deltas: string[] = []
    const result = await provider('ok').generate({
      system: 'sys',
      prompt: 'Selam',
      onText: (t) => deltas.push(t)
    })

    expect(deltas).toEqual(['Merhaba ', 'Sayın ', 'Başkan.'])
    expect(result.text).toBe('Merhaba Sayın Başkan.')
    expect(result.model).toBe('claude-test-model')
    expect(result.costUsd).toBeCloseTo(0.0123)
    expect(result.billing).toBe('subscription')
    expect(result.durationMs).toBe(842)
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 9, cacheReadTokens: 3000, cacheWriteTokens: 0 })
  })

  it('sends the prompt on stdin, the system prompt as a file, and disables tools and settings', async () => {
    const result = await provider('echo', {}, 'sonnet').generate({ system: 'Sen danışmansın.', prompt: 'Ordu hazır mı?' })
    const report = JSON.parse(result.text)

    expect(report.prompt).toBe('Ordu hazır mı?')
    expect(report.system).toBe('Sen danışmansın.')
    expect(report.tools).toBe('')
    expect(report.settingSources).toBe('')
    expect(report.model).toBe('sonnet')
  })

  it('never passes API credentials or nested-session markers to the CLI', async () => {
    const result = await provider('echo', {
      ANTHROPIC_API_KEY: 'sk-should-not-leak',
      ANTHROPIC_AUTH_TOKEN: 'tok',
      CLAUDECODE: '1'
    }).generate({ system: 's', prompt: 'p' })
    const report = JSON.parse(result.text)

    expect(report.hasApiKey).toBe(false)
    expect(report.hasAuthToken).toBe(false)
    expect(report.nested).toBe(false)
  })

  it('turns a CLI error result into a player-readable message', async () => {
    const err = await provider('error')
      .generate({ system: 's', prompt: 'p' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LlmError)
    expect((err as Error).message).toContain('/login')
  })

  it('reports a crash using stderr', async () => {
    const err = await provider('crash')
      .generate({ system: 's', prompt: 'p' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LlmError)
    expect((err as Error).message).toContain('claude update')
  })

  it('stops the CLI when the request is cancelled', async () => {
    const controller = new AbortController()
    const deltas: string[] = []
    const run = provider('slow').generate({
      system: 's',
      prompt: 'p',
      signal: controller.signal,
      onText: (t) => {
        deltas.push(t)
        if (deltas.length === 3) controller.abort()
      }
    })
    const err = await run.catch((e: unknown) => e)
    expect(isAbortError(err)).toBe(true)
    expect(deltas.length).toBeLessThan(200)
  })

  it('reports the CLI version in status', async () => {
    const status = await provider('ok', {}, 'opus').status()
    expect(status).toMatchObject({ provider: 'cli', ready: true, label: 'Claude · abonelik' })
    expect(status.detail).toBe('Claude Code 2.1.283 · opus')
  })

  it('reports a missing CLI as not ready', async () => {
    const missing = new ClaudeCliProvider({ workDir: tmpdir(), resolveCommand: async () => null })
    const status = await missing.status()
    expect(status.ready).toBe(false)
    await expect(missing.generate({ system: 's', prompt: 'p' })).rejects.toBeInstanceOf(LlmError)
  })
})

describe('CLI helpers', () => {
  it('builds arguments without the prompt (it goes through stdin)', () => {
    const args = buildCliArgs({ systemFile: '/tmp/s.md' })
    expect(args).toContain('--no-session-persistence')
    expect(args).not.toContain('--model')
    expect(args[args.indexOf('--system-prompt-file') + 1]).toBe('/tmp/s.md')
  })

  it('removes credentials but keeps everything else', () => {
    const env = subscriptionEnv({ ANTHROPIC_API_KEY: 'x', PATH: '/bin', HOME: '/h' })
    expect(env).toEqual({ PATH: '/bin', HOME: '/h' })
  })

  it('explains common failures in Turkish', () => {
    expect(explainCliFailure('Claude AI usage limit reached|1760000000')).toContain('limit')
    expect(explainCliFailure('something odd')).toBe('Claude Code hata verdi: something odd')
  })
})
