/**
 * Seeded dice (mulberry32). The whole generator state is one uint32 kept in
 * GameState.rng, so a saved game replays exactly the same rolls.
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number
  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number
  readonly state: number
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    get state() {
      return s
    }
  }
}

/**
 * A roll in [0, 1) fixed by a key (e.g. "game|seed|turn"). Used where the outcome must
 * not depend on how many other dice were rolled first, such as deciding which seeds wake.
 */
export function hashRoll(key: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return createRng(h >>> 0).next()
}
