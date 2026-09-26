import type { AiResult } from '@shared/ipc'

export function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
}

const num = (n: number, digits = 0): string => n.toLocaleString('tr-TR', { maximumFractionDigits: digits })

/** Footer facts for an answer, e.g. ["claude-opus-5-5", "5,9 sn", "3.120 → 452 token", "abonelik"]. */
export function resultMeta(result: AiResult): string[] {
  const parts: string[] = []
  if (result.model) parts.push(result.model)
  parts.push(`${num(result.durationMs / 1000, 1)} sn`)

  if (result.usage) {
    const { inputTokens, outputTokens, cacheReadTokens = 0, cacheWriteTokens = 0 } = result.usage
    parts.push(`${num(inputTokens + cacheReadTokens + cacheWriteTokens)} → ${num(outputTokens)} token`)
  }

  const cost = result.costUsd !== undefined && result.costUsd > 0 ? `${num(result.costUsd, 4)} $` : undefined
  if (result.billing === 'subscription') parts.push(cost ? `abonelik (API'de ~${cost})` : 'abonelik')
  else if (cost) parts.push(`~${cost}`)

  return parts
}
