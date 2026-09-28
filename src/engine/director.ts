import type { EffectId } from '@shared/game/catalog'
import type { SeedPlan } from '@shared/game/contract'
import { DEVELOPMENT_TAG, MAJOR_TAG, TONE_TAGS, type Beat, type ConsequenceTone, type Scale, type Stage, type Tone } from '@shared/game/impacts'
import type { GameEvent, GameState, Seed } from '@shared/game/schema'
import { WORLD_BOOK, type WorldBookEntry } from '@shared/game/world-book'
import { findCountry } from './lookup'
import { hashRoll } from './rng'
import { planSeeds } from './seeds'

// The director: the month's pacing. Before the AI is asked anything, the code decides
// whether the world brings something this month, in which tone and how big, and whether a
// delayed consequence comes back. The AI then decides what it is and tells it.
//
// The aim is a world that punctuates, not one that punishes: most months are calm, news is
// mixed (openings, good luck, plain events, now and then trouble), a troubled month is rarely
// followed by another, and big shocks are rare. All rolls are keyed by game and turn, so a
// saved game replays the same way.

export const PACING = {
  /** Chance of a development by months since the world's last one (the last value holds after). */
  chanceByGap: [0.1, 0.25, 0.4, 0.55],
  /** A delayed consequence coming back this month often fills the month on its own. */
  withConsequence: 0.2,
  /** A delayed consequence is less likely to come back right after a busy month. */
  consequenceAfterBusy: 0.5,
  tones: { opportunity: 0.27, good: 0.2, neutral: 0.2, trouble: 0.33 } satisfies Record<Tone, number>,
  /** After trouble the next development is rarely trouble again. */
  troubleAfterTrouble: 0.35,
  /** A struggling government meets more openings; a comfortable one more trouble. */
  struggling: { trouble: 0.6, opportunity: 1.5 },
  comfortable: { trouble: 1.35, opportunity: 0.85 },
  /** Share of developments (and consequences) that are big, and the months between two big ones. */
  majorChance: 0.18,
  majorGap: 8,
  stages: { home: 0.4, country: 0.35, world: 0.25 },
  /**
   * How an earlier decision comes back. Sweet now, bitter later ("bill"); bitter now, sweet
   * later ("payoff"); anything else either way. The AI tells what it becomes, in that tone.
   */
  consequenceTones: {
    bill: { good: 0.1, neutral: 0.1, trouble: 0.8 },
    payoff: { good: 0.65, neutral: 0.15, trouble: 0.2 },
    either: { good: 0.4, neutral: 0.2, trouble: 0.4 }
  }
} as const

/** Which decisions tend to send a bill later, and which tend to pay off (the rest can go either way). */
export const CONSEQUENCE_LEAN: Partial<Record<EffectId, 'bill' | 'payoff'>> = {
  tax_cut: 'bill',
  anti_corruption_drive: 'bill',
  fiscal_stimulus: 'bill',
  minimum_wage_raise: 'bill',
  mega_project: 'bill',
  press_crackdown: 'bill',
  opposition_crackdown: 'bill',
  emergency_rule: 'bill',
  security_operation: 'bill',
  military_buildup: 'bill',
  mobilization: 'bill',
  border_deployment: 'bill',
  naval_show_of_force: 'bill',
  cross_border_operation: 'bill',
  sanctions: 'bill',
  tariff_hike: 'bill',
  recall_ambassador: 'bill',
  migration_control: 'bill',
  national_rally: 'bill',
  reckless_gambit: 'bill',
  austerity: 'payoff',
  interest_rate_hike: 'payoff',
  regional_investment: 'payoff',
  education_reform: 'payoff',
  judicial_reform: 'payoff',
  trade_agreement: 'payoff',
  energy_deal: 'payoff',
  state_visit: 'payoff',
  peace_mediation: 'payoff',
  humanitarian_aid: 'payoff',
  tourism_campaign: 'payoff',
  defense_industry: 'payoff',
  social_housing: 'payoff',
  eu_accession_bid: 'payoff',
  summit_hosting: 'payoff',
  ceasefire_offer: 'payoff',
  military_aid: 'payoff'
}

/** Something notable in the past: the world's own development, or a consequence that came back. */
export interface Happening {
  turn: number
  tone: Tone
  major: boolean
  /** A consequence of an earlier decision (else the world's own development). */
  consequence?: boolean
}

/** Reads the pacing's own history from the event log (events tagged as developments). */
export function happeningsFrom(events: readonly GameEvent[]): Happening[] {
  return events
    .filter((e) => e.tags.includes(DEVELOPMENT_TAG))
    .map((e) => ({
      turn: e.turn,
      tone: (Object.entries(TONE_TAGS).find(([, tag]) => e.tags.includes(tag))?.[0] as Tone | undefined) ?? 'neutral',
      major: e.tags.includes(MAJOR_TAG),
      ...(e.kind === 'seed_fired' ? { consequence: true } : {})
    }))
    .sort((a, b) => b.turn - a.turn)
}

/**
 * Plans the coming month: which due seeds come back (at most one), whether the world brings
 * a development of its own, its tone, size and stage.
 */
export function planMonth(state: GameState, candidates: readonly Seed[], past: readonly Happening[]): SeedPlan {
  const turn = state.turn + 1
  const roll = (what: string): number => hashRoll(`${state.gameId}|${what}|${turn}`)
  const latest = (list: readonly Happening[]): Happening | null =>
    list.reduce<Happening | null>((a, h) => (h.turn < turn && (!a || h.turn > a.turn) ? h : a), null)
  const last = latest(past)
  const lastDevelopment = latest(past.filter((h) => !h.consequence))
  const gap = lastDevelopment ? turn - lastDevelopment.turn - 1 : PACING.chanceByGap.length
  const lastMajor = past.filter((h) => h.major && h.turn < turn).reduce((n, h) => Math.max(n, h.turn), -Infinity)
  const majorAllowed = turn - lastMajor >= PACING.majorGap

  const busyLastMonth = last !== null && last.turn === turn - 1
  const seeds = planSeeds(state, candidates, busyLastMonth ? PACING.consequenceAfterBusy : 1)
  // The player's own decisions may come back at full weight (they chose them); something that
  // brewed abroad on its own is kept small unless the dice make it one of the big stories.
  const firing = seeds.firing[0]
  const own = firing?.sourceEffectId != null
  const seedScale: Scale = firing && (own || (majorAllowed && roll('seed-major') < PACING.majorChance)) ? 'major' : 'minor'
  const seedTone = firing ? consequenceTone(state, firing, roll('seed-tone')) : undefined
  const month = { ...seeds, seedScale, ...(seedTone ? { seedTone } : {}) }

  let chance = PACING.chanceByGap[Math.min(gap, PACING.chanceByGap.length - 1)]!
  if (firing) chance *= PACING.withConsequence
  if (roll('beat') >= chance) return { ...month, beat: null }

  const tone = pickTone(state, last, roll('tone'))
  const scale: Scale = majorAllowed && roll('major') < PACING.majorChance ? 'major' : 'minor'
  const beat: Beat = { tone, scale, stage: pickStage(state, tone, roll('stage'), roll('stage-who')) }
  return { ...month, beat }
}

/**
 * The tone an earlier decision comes back in, from what kind of decision it was. Not softened
 * after trouble: the player chose these, and the bills of a spree come one after another.
 * A government riding high gets its bills more surely (no mercy the other way: a government
 * that rules by force and slides in the polls still pays for it).
 */
function consequenceTone(state: GameState, seed: Seed, roll: number): ConsequenceTone {
  const lean = (seed.sourceEffectId && CONSEQUENCE_LEAN[seed.sourceEffectId]) || 'either'
  const weights: Record<ConsequenceTone, number> = { ...PACING.consequenceTones[lean] }
  if (moodOf(state) === 'comfortable') {
    weights.trouble *= PACING.comfortable.trouble
    weights.good *= 0.5
  }
  return weighted(weights, roll)
}

/** How the government stands: behind in the polls or shaky, comfortably ahead, or neither. */
function moodOf(state: GameState): 'struggling' | 'comfortable' | null {
  const me = findCountry(state, state.playerCountryId)
  if (!me) return null
  const margin = me.bars.approval - state.election.threshold
  if (margin < -5 || me.bars.stability < 45) return 'struggling'
  return margin >= 8 ? 'comfortable' : null
}

function pickTone(state: GameState, last: Happening | null, roll: number): Tone {
  const weights: Record<Tone, number> = { ...PACING.tones }
  if (last?.tone === 'trouble') weights.trouble *= PACING.troubleAfterTrouble
  const mood = moodOf(state)
  if (mood) {
    weights.trouble *= PACING[mood].trouble
    weights.opportunity *= PACING[mood].opportunity
  }
  return weighted(weights, roll)
}

/** Friendly countries bring more of the good news, hostile ones more of the trouble. */
const STANCE_BY_TONE: Record<Tone, Record<WorldBookEntry['stance'], number>> = {
  opportunity: { ally: 3, partner: 3, wary: 1.5, rival: 1, hostile: 0.5 },
  good: { ally: 3, partner: 3, wary: 1, rival: 0.5, hostile: 0.3 },
  neutral: { ally: 1, partner: 1.5, wary: 1.5, rival: 1.5, hostile: 1 },
  trouble: { ally: 0.3, partner: 1, wary: 2.5, rival: 3, hostile: 3 }
}

function pickStage(state: GameState, tone: Tone, roll: number, whoRoll: number): Stage {
  const kind = weighted({ ...PACING.stages }, roll)
  if (kind !== 'country') return { kind }
  const pool = Object.entries(WORLD_BOOK).filter(([id]) => id !== state.playerCountryId && findCountry(state, id))
  const weights = Object.fromEntries(pool.map(([id, e]) => [id, STANCE_BY_TONE[tone][e.stance]]))
  return pool.length > 0 ? { kind: 'country', id: weighted(weights, whoRoll) } : { kind: 'world' }
}

function weighted<K extends string>(weights: Record<K, number>, roll: number): K {
  const entries = Object.entries(weights) as Array<[K, number]>
  const total = entries.reduce((n, [, w]) => n + w, 0)
  let left = roll * total
  for (const [key, w] of entries) {
    left -= w
    if (left < 0) return key
  }
  return entries.at(-1)![0]
}
