import { describe, expect, it } from 'vitest'
import { resultMeta } from '../src/renderer/src/lib/format'

describe('resultMeta', () => {
  it('counts cached input tokens and labels subscription cost as an API equivalent', () => {
    const parts = resultMeta({
      text: 'x',
      model: 'claude-opus-5-5',
      durationMs: 5900,
      usage: { inputTokens: 2, outputTokens: 452, cacheReadTokens: 3000, cacheWriteTokens: 120 },
      costUsd: 0.0157,
      billing: 'subscription'
    })
    expect(parts).toEqual(['claude-opus-5-5', '5,9 sn', '3.122 → 452 token', "abonelik (API'de ~0,0157 $)"])
  })

  it('shows plain cost for the API and nothing for free answers', () => {
    expect(resultMeta({ text: 'x', durationMs: 1000, costUsd: 0.5, billing: 'api' })).toEqual(['1 sn', '~0,5 $'])
    expect(resultMeta({ text: 'x', durationMs: 1000, costUsd: 0 })).toEqual(['1 sn'])
  })
})
