import { z } from 'zod'
import { BarId } from './primitives'

// Improvised developments and the month's pacing, shared by the engine, the referee and
// the prompts.
//
// When no catalog effect fits the story, the AI names the event itself and describes its
// shape in words: which bar, which way, how big, for how long. The code turns those words
// into numbers from the tables below, so the AI still never writes a number.
//
// The pacing (how often something happens, and in which tone) is decided by the code
// before the AI is asked (src/engine/director.ts); the AI decides what happens.

export const ImpactSize = z.enum(['small', 'clear', 'large'])
export type ImpactSize = z.infer<typeof ImpactSize>

export const Impact = z.strictObject({
  bar: BarId,
  change: z.enum(['up', 'down']),
  size: ImpactSize,
  /** true: repeats every month while it lasts; false: hits once, when it starts. */
  monthly: z.boolean()
})
export type Impact = z.infer<typeof Impact>

/** How long an improvised development keeps acting. */
export const Lasts = z.enum(['month', 'season', 'half_year'])
export type Lasts = z.infer<typeof Lasts>

/** Size in words → points, hit once. Same scale as the catalog (a protest wave shakes stability by 7). */
export const IMPACT_ONCE: Record<ImpactSize, number> = { small: 2, clear: 4, large: 7 }
/** Size in words → points every month while it lasts. */
export const IMPACT_MONTHLY: Record<ImpactSize, number> = { small: 1, clear: 2, large: 3 }
export const LASTS_TURNS: Record<Lasts, number> = { month: 1, season: 3, half_year: 6 }
export const MAX_IMPACTS = 3

/** The numbers behind an impact, landing on the development's target. */
export function impactDelta(impact: Impact): number {
  const size = impact.monthly ? IMPACT_MONTHLY[impact.size] : IMPACT_ONCE[impact.size]
  return impact.change === 'up' ? size : -size
}

/**
 * A change's weight for the country it lands on: one-off points plus monthly points over
 * the whole run. Positive = good for that country. Used to keep the month's news in scale.
 */
export function weightOf(modifiers: ReadonlyArray<{ delta: number; mode: 'once' | 'per_turn' }>, turns: number): number {
  return modifiers.reduce((sum, m) => sum + (m.mode === 'per_turn' ? m.delta * turns : m.delta), 0)
}

export function impactWeight(impacts: readonly Impact[], lasts: Lasts): number {
  return weightOf(
    impacts.map((i) => ({ delta: impactDelta(i), mode: i.monthly ? 'per_turn' : 'once' })),
    LASTS_TURNS[lasts]
  )
}

// ── the month's pacing ─────────────────────────────────────────────────────

/** What kind of development the month brings, as the code rolled it. */
export const Tone = z.enum(['opportunity', 'good', 'neutral', 'trouble'])
export type Tone = z.infer<typeof Tone>

/** The tone an earlier decision comes back in (the code rolls it; openings are the world's). */
export type ConsequenceTone = Exclude<Tone, 'opportunity'>

export const Scale = z.enum(['minor', 'major'])
export type Scale = z.infer<typeof Scale>

/** Where it starts: at home, in one country, or somewhere in the world with a knock-on effect. */
export type Stage = { kind: 'home' } | { kind: 'country'; id: string } | { kind: 'world' }

/** The month's development slot: the code picks the tone and size, the AI writes what happens. */
export interface Beat {
  tone: Tone
  scale: Scale
  stage: Stage
}

/**
 * How big a development may be. `maxWeight` bounds its total weight on the player; the
 * largest words it may use keep single blows in proportion (a minor event is never a shock).
 */
export const SCALE_LIMITS: Record<Scale, { maxWeight: number; largest: ImpactSize; largestMonthly: ImpactSize }> = {
  minor: { maxWeight: 10, largest: 'clear', largestMonthly: 'small' },
  major: { maxWeight: 20, largest: 'large', largestMonthly: 'clear' }
}

const SIZE_ORDER: Record<ImpactSize, number> = { small: 0, clear: 1, large: 2 }
export const sizeFits = (size: ImpactSize, largest: ImpactSize): boolean => SIZE_ORDER[size] <= SIZE_ORDER[largest]

/** Whether a development's weight on the player fits the tone the code rolled. */
export function fitsTone(tone: Tone, weight: number): boolean {
  switch (tone) {
    case 'good':
      return weight >= 2
    case 'opportunity':
      return weight >= 0
    case 'neutral':
      return Math.abs(weight) <= 3
    case 'trouble':
      return weight <= -1
  }
}

/**
 * Whether a consequence's weight on the player does not contradict the tone the code rolled.
 * Softer than a development's check: a consequence told only as a story always fits.
 */
export function consequenceFits(tone: ConsequenceTone, weight: number): boolean {
  return tone === 'good' ? weight >= 0 : tone === 'trouble' ? weight <= 0 : Math.abs(weight) <= 3
}

/** The tone a finished development turned out to have, from its weight on the player. */
export function toneOfWeight(weight: number): Exclude<Tone, 'opportunity'> {
  return weight >= 2 ? 'good' : weight <= -2 ? 'trouble' : 'neutral'
}

/** Tags that mark a development in the event log, so the pacing can read its own history. */
export const DEVELOPMENT_TAG = 'gelisme'
export const TONE_TAGS: Record<Tone, string> = { opportunity: 'ton-firsat', good: 'ton-iyi', neutral: 'ton-notr', trouble: 'ton-kriz' }
export const MAJOR_TAG = 'olcek-buyuk'
