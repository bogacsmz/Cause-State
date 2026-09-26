import type { AiUsage } from '@shared/ipc'

// Parser for `claude -p --output-format stream-json --verbose --include-partial-messages`.
// Each stdout line is one JSON event; we only need the text deltas, the model from
// the init event, and the final `result` line.

export type CliEvent =
  | { kind: 'text'; text: string }
  /** A fragment of structured output (the JSON being written, with --json-schema). */
  | { kind: 'json'; text: string }
  | { kind: 'model'; model: string }
  | {
      kind: 'result'
      ok: boolean
      text: string
      costUsd?: number
      usage?: AiUsage
      durationMs?: number
    }
  | { kind: 'ignore' }

const IGNORE: CliEvent = { kind: 'ignore' }

export function parseCliLine(line: string): CliEvent {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return IGNORE

  let msg: Record<string, unknown>
  try {
    msg = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return IGNORE
  }

  switch (msg.type) {
    case 'system':
      return msg.subtype === 'init' && typeof msg.model === 'string'
        ? { kind: 'model', model: msg.model }
        : IGNORE

    case 'stream_event': {
      const event = asRecord(msg.event)
      const delta = asRecord(event?.delta)
      if (event?.type === 'content_block_delta' && delta?.type === 'text_delta' && typeof delta.text === 'string') {
        return { kind: 'text', text: delta.text }
      }
      if (event?.type === 'content_block_delta' && delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        return { kind: 'json', text: delta.partial_json }
      }
      return IGNORE
    }

    case 'result':
      return {
        kind: 'result',
        ok: msg.is_error !== true && msg.subtype === 'success',
        // With --json-schema the validated document arrives as structured_output.
        text:
          msg.structured_output !== undefined && msg.structured_output !== null
            ? JSON.stringify(msg.structured_output)
            : typeof msg.result === 'string'
              ? msg.result
              : '',
        costUsd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : undefined,
        usage: parseUsage(msg.usage),
        durationMs: typeof msg.duration_ms === 'number' ? msg.duration_ms : undefined
      }

    default:
      return IGNORE
  }
}

function parseUsage(raw: unknown): AiUsage | undefined {
  const u = asRecord(raw)
  if (!u) return undefined
  return {
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheReadTokens: num(u.cache_read_input_tokens),
    cacheWriteTokens: num(u.cache_creation_input_tokens)
  }
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0
}
