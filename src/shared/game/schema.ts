import { z } from 'zod'
import { EffectId } from './catalog'
import { Bars, BarId, BarValue, CountryId, EntityRef, entityKey, IsoDate, ProvinceId, Tag, Turn } from './primitives'

// The hard state of the world and the long-term memory records. Code owns every
// field here; the LLM only ever sees summaries of it and proposes changes to it.

export const Regime = z.enum(['democracy', 'hybrid', 'authoritarian'])
export type Regime = z.infer<typeof Regime>

export const Country = z.strictObject({
  id: CountryId,
  /** Turkish display name. */
  name: z.string().min(1),
  regime: Regime,
  bars: Bars,
  /** Where slow-moving bars (sovereignty, military, reputation) drift back to when nothing pushes them. */
  anchors: Bars,
  /** Next national election, or null where there is none. */
  nextElection: IsoDate.nullable()
})
export type Country = z.infer<typeof Country>

export const Province = z.strictObject({
  id: ProvinceId,
  name: z.string().min(1),
  /** Legal owner. */
  owner: CountryId,
  /** Who actually holds it (differs under occupation). */
  controller: CountryId
})
export type Province = z.infer<typeof Province>

/** An effect's numbers resolved onto a concrete country when it was applied. */
export const ResolvedModifier = z.strictObject({
  country: CountryId,
  bar: BarId,
  delta: z.int(),
  mode: z.enum(['once', 'per_turn'])
})
export type ResolvedModifier = z.infer<typeof ResolvedModifier>

export const ActiveEffect = z.strictObject({
  id: z.string().min(1),
  effectId: EffectId,
  /** Who caused it. For world effects (society, markets) this is the affected country itself. */
  actor: CountryId,
  target: EntityRef,
  source: z.enum(['player', 'foreign', 'world']),
  /** Set when this effect is the consequence of a fired butterfly seed. */
  seedId: z.string().nullable(),
  appliedTurn: Turn,
  /** First turn it is no longer active; null = until removed. */
  expiresTurn: Turn.nullable(),
  modifiers: z.array(ResolvedModifier),
  originEventId: z.string().min(1)
})
export type ActiveEffect = z.infer<typeof ActiveEffect>

export const EventKind = z.enum([
  'order',
  'effect_applied',
  'effect_expired',
  'foreign_action',
  'seed_planted',
  'seed_fired',
  'seed_fizzled',
  'election',
  'coup',
  'warning',
  'narration',
  'system'
])
export type EventKind = z.infer<typeof EventKind>

/** One line of history. Never deleted; the event log is the game's long-term memory. */
export const GameEvent = z.strictObject({
  id: z.string().min(1),
  turn: Turn,
  date: IsoDate,
  kind: EventKind,
  /** Hidden events (e.g. planted seeds) are memory for the game, not news for the player. */
  visibility: z.enum(['public', 'hidden']),
  title: z.string().min(1).max(160),
  summary: z.string().max(2000),
  entities: z.array(EntityRef),
  tags: z.array(Tag),
  /** The event that caused this one: the thread the cause-and-effect tree follows. */
  causeId: z.string().nullable(),
  effectId: EffectId.optional(),
  seedId: z.string().optional()
})
export type GameEvent = z.infer<typeof GameEvent>

export const Dormancy = z.enum(['short', 'medium', 'long'])
export const Likelihood = z.enum(['unlikely', 'possible', 'likely'])

/** Extra condition a seed waits for; thresholds for "low" are code constants. */
export const SeedCondition = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('bar_low'), country: CountryId, bar: BarId }),
  z.strictObject({ kind: z.literal('effect_active'), effectId: EffectId, country: CountryId })
])
export type SeedCondition = z.infer<typeof SeedCondition>

/**
 * A butterfly-effect seed: something a decision set in motion that may come back
 * later. Code tracks and fires it; the LLM only writes the hook and, later, the story.
 */
export const Seed = z.strictObject({
  id: z.string().min(1),
  plantedTurn: Turn,
  /** Earliest turn it may fire. */
  wakeTurn: Turn,
  originEventId: z.string().min(1),
  /** The decision that planted it, for "this came from what you did on turn N". */
  sourceEffectId: EffectId.nullable(),
  hook: z.string().min(1).max(600),
  entities: z.array(EntityRef).min(1),
  tags: z.array(Tag),
  likelihood: Likelihood,
  condition: SeedCondition.nullable(),
  status: z.enum(['dormant', 'fired', 'defused']),
  firedTurn: Turn.nullable()
})
export type Seed = z.infer<typeof Seed>

/** Why a bar moved this turn. */
export const BarCause = z.strictObject({
  label: z.string().min(1),
  delta: z.int(),
  kind: z.enum(['effect', 'drift', 'noise', 'event']),
  effectId: EffectId.optional(),
  seedId: z.string().optional()
})
export type BarCause = z.infer<typeof BarCause>

export const BarChange = z.strictObject({
  bar: BarId,
  before: BarValue,
  after: BarValue,
  causes: z.array(BarCause)
})
export type BarChange = z.infer<typeof BarChange>

/** End-of-turn summary for the player: every bar with its causes, plus the turn's big moments. */
export const TurnReport = z.strictObject({
  turn: Turn,
  date: IsoDate,
  bars: z.array(BarChange),
  capital: z.strictObject({ spent: z.int().min(0), next: z.int().min(0) }),
  firedSeeds: z.array(
    z.strictObject({
      seedId: z.string(),
      plantedTurn: Turn,
      effectId: EffectId,
      /** The player's decision that planted it; null when the world itself set it in motion. */
      source: EffectId.nullable(),
      /** Where it came from, in words: the decision's name, or "Dünya gündemi". */
      origin: z.string()
    })
  ),
  expired: z.array(z.string()),
  election: z.strictObject({ vote: z.int(), threshold: z.int(), won: z.boolean() }).nullable(),
  coup: z.strictObject({ chance: z.number().min(0).max(1), happened: z.boolean() }).nullable()
})
export type TurnReport = z.infer<typeof TurnReport>

export const Ending = z.strictObject({
  kind: z.enum(['election_lost', 'coup']),
  turn: Turn,
  title: z.string().min(1),
  detail: z.string()
})
export type Ending = z.infer<typeof Ending>

/**
 * The hard state snapshot: small, the world as it is right now. History (events)
 * and seeds live in their own SQLite tables, so this never grows with game length.
 */
export const GameState = z
  .strictObject({
    version: z.literal(1),
    gameId: z.string().min(1),
    turn: Turn,
    date: IsoDate,
    playerCountryId: CountryId,
    status: z.enum(['playing', 'lost']),
    ending: Ending.nullable(),
    election: z.strictObject({
      nextTurn: Turn,
      everyTurns: z.int().min(1),
      /** Vote share needed to stay in power. */
      threshold: z.int().min(1).max(100),
      last: z.strictObject({ turn: Turn, vote: z.int(), won: z.boolean() }).nullable()
    }),
    politicalCapital: z.strictObject({
      current: z.int().min(0),
      perTurn: z.int().min(0),
      max: z.int().min(1)
    }),
    countries: z.array(Country).min(1),
    provinces: z.array(Province),
    effects: z.array(ActiveEffect),
    /** Seeded dice state (uint32); the same seed replays the same game. */
    rng: z.int().min(0).max(0xffffffff),
    /** Next number for each kind of generated id. */
    counters: z.strictObject({ event: z.int().min(0), effect: z.int().min(0), seed: z.int().min(0) }),
    /** What happened last turn, for the end-of-turn summary. */
    lastReport: TurnReport.nullable()
  })
  .superRefine((state, ctx) => {
    const countries = new Set(state.countries.map((c) => c.id))
    const provinces = new Set(state.provinces.map((p) => p.id))
    const exists = (ref: EntityRef): boolean => (ref.type === 'country' ? countries : provinces).has(ref.id)
    const issue = (path: (string | number)[], message: string): void => ctx.addIssue({ code: 'custom', path, message })

    if (countries.size !== state.countries.length) issue(['countries'], 'duplicate country id')
    if (provinces.size !== state.provinces.length) issue(['provinces'], 'duplicate province id')
    if (!countries.has(state.playerCountryId)) issue(['playerCountryId'], 'player country missing from countries')

    state.provinces.forEach((p, i) => {
      if (!countries.has(p.owner)) issue(['provinces', i, 'owner'], `unknown country ${p.owner}`)
      if (!countries.has(p.controller)) issue(['provinces', i, 'controller'], `unknown country ${p.controller}`)
    })
    state.effects.forEach((e, i) => {
      if (!countries.has(e.actor)) issue(['effects', i, 'actor'], `unknown country ${e.actor}`)
      if (!exists(e.target)) issue(['effects', i, 'target'], `unknown target ${entityKey(e.target)}`)
    })
  })
export type GameState = z.infer<typeof GameState>
