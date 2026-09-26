// Turkish case endings after numbers written in digits: "Tur 3'te", "6'dan beri",
// "36'ya düştü", "oyların %54'ü". The ending follows how the number is read aloud.

/** 'de' locative, 'den' ablative, 'e' dative, 'i' third-person possessive. */
export type NumberCase = 'de' | 'den' | 'e' | 'i'

const ONES = ['', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz']
const TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan']
const VOWELS = 'aeıioöuü'

/** The last word you say when reading the number, e.g. 36 → "altı", 40 → "kırk". */
function lastWord(value: number): string {
  const n = Math.abs(Math.trunc(value))
  if (n === 0) return 'sıfır'
  if (n % 10) return ONES[n % 10]!
  if (n % 100) return TENS[(n % 100) / 10]!
  if (n % 1000) return 'yüz'
  if (n % 1_000_000) return 'bin'
  return 'milyon'
}

/** The number with its case ending, e.g. ek(3, 'de') → "3'te", ek(36, 'e') → "36'ya". */
export function ek(n: number, kind: NumberCase): string {
  const word = lastWord(n)
  const vowel = [...word].reverse().find((c) => VOWELS.includes(c)) ?? 'e'
  const front = 'eiöü'.includes(vowel)
  const last = word.at(-1) ?? ''
  const endsInVowel = VOWELS.includes(last)
  const d = 'çfhkpsşt'.includes(last) ? 't' : 'd'
  const a = front ? 'e' : 'a'
  const suffix = {
    de: `${d}${a}`,
    den: `${d}${a}n`,
    e: `${endsInVowel ? 'y' : ''}${a}`,
    i: `${endsInVowel ? 's' : ''}${'aı'.includes(vowel) ? 'ı' : 'ei'.includes(vowel) ? 'i' : 'ou'.includes(vowel) ? 'u' : 'ü'}`
  }[kind]
  return `${n}'${suffix}`
}
