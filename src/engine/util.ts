import type { Tag } from '@shared/game/primitives'

const TR_ASCII: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' }

/** "Basın Özgürlüğü" → "basin-ozgurlugu". Returns null if nothing usable is left. */
export function normalizeTag(raw: string): Tag | null {
  const tag = raw
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]/g, (ch) => TR_ASCII[ch] ?? ch)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '')
  return tag.length > 0 ? tag : null
}

export function uniqueTags(raw: readonly string[]): Tag[] {
  return [...new Set(raw.map(normalizeTag).filter((t): t is Tag => t !== null))]
}

/** Adds whole calendar months to a YYYY-MM-DD date, clamping to the month's last day. */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number]
  const first = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(d, lastDay))
  return first.toISOString().slice(0, 10)
}

/** Zero-padded sequential id, e.g. formatId('ev', 7) → "ev-000007". */
export function formatId(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(6, '0')}`
}

export function truncate(text: string, max: number): string {
  const clean = text.trim()
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`
}

/** Rough token estimate for budgeting (conservative for Turkish text and JSON). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3)
}
