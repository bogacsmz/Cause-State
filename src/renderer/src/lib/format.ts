const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

/** "2026-02-01" → "Şubat 2026". */
export function monthYear(isoDate: string): string {
  const [year, month] = isoDate.split('-')
  return `${MONTHS[Number(month) - 1] ?? ''} ${year ?? ''}`.trim()
}

/** +3 / −2 / 0, with a real minus sign. */
export function signed(n: number): string {
  if (n > 0) return `+${n}`
  if (n < 0) return `−${Math.abs(n)}`
  return '0'
}

export function percent(share: number): string {
  return `%${Math.round(share * 100)}`
}

/** "Onay +5" → 'up', "Ekonomi -1/tur" → 'down', "3 tur" → 'neutral'. */
export function lineTone(line: string): 'up' | 'down' | 'neutral' {
  if (/\+\d/.test(line)) return 'up'
  if (/-\d/.test(line)) return 'down'
  return 'neutral'
}

/** Effect lines use an ASCII minus from the engine; show a real one. */
export function prettyLine(line: string): string {
  return line.replace(/-(\d)/g, '−$1')
}
