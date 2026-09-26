import { describe, expect, it } from 'vitest'
import { ek } from '../src/shared/tr'
import { lineTone, monthYear, percent, prettyLine, signed } from '../src/renderer/src/lib/format'

describe('screen formatting', () => {
  it('writes game dates as Turkish month and year', () => {
    expect(monthYear('2026-02-01')).toBe('Şubat 2026')
    expect(monthYear('2027-12-01')).toBe('Aralık 2027')
  })

  it('signs changes with a real minus', () => {
    expect([signed(3), signed(-2), signed(0)]).toEqual(['+3', '−2', '0'])
    expect(percent(0.149)).toBe('%15')
  })

  it('colours effect lines by direction', () => {
    expect(['Onay +5', 'Ekonomi -1/tur', '4 tur', 'Hedef: Ekonomi -2/tur'].map(lineTone)).toEqual(['up', 'down', 'neutral', 'down'])
    expect(prettyLine('Ekonomi -1/tur')).toBe('Ekonomi −1/tur')
  })

  it('puts the right Turkish ending after a number', () => {
    expect([1, 3, 6, 9, 10, 40, 50, 100].map((n) => ek(n, 'de'))).toEqual(["1'de", "3'te", "6'da", "9'da", "10'da", "40'ta", "50'de", "100'de"])
    expect(ek(6, 'den')).toBe("6'dan")
    expect([36, 2, 5, 30].map((n) => ek(n, 'e'))).toEqual(["36'ya", "2'ye", "5'e", "30'a"])
    expect([54, 50, 46, 60, 9].map((n) => ek(n, 'i'))).toEqual(["54'ü", "50'si", "46'sı", "60'ı", "9'u"])
  })
})
