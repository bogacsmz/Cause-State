import { Narration } from '@shared/game/contract'

/**
 * The decoded value of a string field in a JSON document that is still being written,
 * e.g. the "reply" of an answer streaming in. Returns what has arrived so far, or null if
 * the field has not started yet. Used to show Claude's words while the rest is on its way.
 */
export function partialStringField(json: string, field: string): string | null {
  const key = new RegExp(`"${field}"\\s*:\\s*"`)
  const match = key.exec(json)
  if (!match) return null
  let out = ''
  for (let i = match.index + match[0].length; i < json.length; i++) {
    const ch = json[i]!
    if (ch === '"') return out
    if (ch !== '\\') {
      out += ch
      continue
    }
    const next = json[i + 1]
    if (next === undefined) return out
    if (next === 'u') {
      const hex = json.slice(i + 2, i + 6)
      if (hex.length < 4) return out
      out += String.fromCharCode(Number.parseInt(hex, 16))
      i += 5
      continue
    }
    out += ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' } as Record<string, string>)[next] ?? next
    i += 1
  }
  return out
}

/** Parses a JSON answer; tolerates a markdown fence around it. */
export function parseJsonAnswer(text: string): unknown {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed)
  return JSON.parse(fenced ? fenced[1]! : trimmed)
}

/** Splits the newsroom's text into a headline (first line) and a body, within the contract's limits. */
export function parseNarration(text: string): Narration | null {
  const lines = text.replace(/\r/g, '').split('\n')
  const first = lines.findIndex((l) => l.trim().length > 0)
  if (first === -1) return null
  const headline = lines[first]!
    .trim()
    .replace(/^#+\s*/, '')
    .replace(/^\*\*(.*)\*\*$/, '$1')
    .replace(/^["“”'](.*)["“”']$/, '$1')
    .trim()
  const body = lines
    .slice(first + 1)
    .join('\n')
    .trim()
    .replace(/\n{3,}/g, '\n\n')
  const parsed = Narration.safeParse({ headline: clip(headline, 120), body: clip(body, 1500) })
  return parsed.success ? parsed.data : null
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'))
  return end > max * 0.6 ? cut.slice(0, end + 1) : `${cut}…`
}
