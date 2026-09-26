import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ClaudeCliProvider } from '../src/main/ai/claude-cli'
import { resolveClaude } from '../src/main/ai/find-claude'

// Calls the real Claude Code CLI with your subscription (a few hundred tokens).
// Skipped by default; run with: CS_LIVE_CLI=1 npx vitest run tests/live-cli.test.ts
describe.skipIf(!process.env.CS_LIVE_CLI)('Claude Code CLI (live)', () => {
  it('answers through claude -p and streams text', async () => {
    const provider = new ClaudeCliProvider({
      workDir: join(tmpdir(), 'cause-state-claude-live'),
      model: process.env.CS_AI_MODEL,
      resolveCommand: () => resolveClaude()
    })

    const status = await provider.status()
    expect(status.ready, status.detail).toBe(true)

    const deltas: string[] = []
    const result = await provider.generate({
      system: 'Reply in Turkish with exactly one short sentence.',
      prompt: 'Bağlantı testi: kısa bir selam ver.',
      onText: (t) => deltas.push(t)
    })

    console.log(`[live] ${status.detail} | model=${result.model} | ${result.durationMs} ms | $${result.costUsd} | "${result.text}"`)
    expect(result.text.length).toBeGreaterThan(0)
    expect(deltas.join('')).toBe(result.text)
  }, 120_000)
})
