import { describe, expect, it } from 'vitest'
import { parseCliLine } from '../src/main/ai/claude-cli-stream'

const line = (obj: unknown): string => JSON.stringify(obj)

describe('parseCliLine', () => {
  it('reads the model from the init event', () => {
    expect(parseCliLine(line({ type: 'system', subtype: 'init', model: 'claude-opus-5' }))).toEqual({
      kind: 'model',
      model: 'claude-opus-5'
    })
  })

  it('extracts text deltas and ignores thinking deltas', () => {
    const text = { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ab' } } }
    const thinking = {
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'x' } }
    }
    expect(parseCliLine(line(text))).toEqual({ kind: 'text', text: 'ab' })
    expect(parseCliLine(line(thinking))).toEqual({ kind: 'ignore' })
  })

  it('parses a successful result with usage and cost', () => {
    const event = parseCliLine(
      line({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Tamam.',
        total_cost_usd: 0.5,
        duration_ms: 1200,
        usage: { input_tokens: 10, output_tokens: 3 }
      })
    )
    expect(event).toEqual({
      kind: 'result',
      ok: true,
      text: 'Tamam.',
      costUsd: 0.5,
      durationMs: 1200,
      usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 }
    })
  })

  it('marks error results as not ok', () => {
    const event = parseCliLine(line({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in' }))
    expect(event).toMatchObject({ kind: 'result', ok: false, text: 'Not logged in' })
  })

  it('ignores assistant messages, blank lines and non-JSON output', () => {
    expect(parseCliLine(line({ type: 'assistant', message: {} }))).toEqual({ kind: 'ignore' })
    expect(parseCliLine('')).toEqual({ kind: 'ignore' })
    expect(parseCliLine('Warning: something')).toEqual({ kind: 'ignore' })
    expect(parseCliLine('{broken')).toEqual({ kind: 'ignore' })
  })
})
