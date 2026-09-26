import { z } from 'zod'
import { EffectId } from './catalog'
import { Bars, CountryId, EntityRef, IsoDate, Turn } from './primitives'
import { Dormancy, Likelihood, Regime, SeedCondition, type GameEvent, type GameState, type Seed } from './schema'

// The contract between code and the LLM, both directions:
//   code → LLM:  TurnRequest  (compact, bounded context)
//   LLM → code:  ChangeList   (a proposal; the referee decides what becomes real)

/** Hard caps that keep every turn's context the same size at turn 5 and at turn 500. */
export const LIMITS = {
  orderChars: 1500,
  changes: 4,
  foreignIntents: 4,
  newSeeds: 3,
  reasonChars: 300,
  seedHookChars: 300,
  activeEffects: 10,
  worldCountries: 12,
  recentEvents: 12,
  eventSummaryChars: 280,
  relevantSeeds: 8
} as const

/** Upper bound for a serialised TurnRequest, in estimated tokens. */
export const TURN_REQUEST_TOKEN_BUDGET = 6000

// ── code → LLM ──────────────────────────────────────────────────────────────

export const TurnRequest = z.strictObject({
  turn: Turn,
  date: IsoDate,
  player: z.strictObject({
    country: CountryId,
    name: z.string(),
    regime: Regime,
    bars: Bars,
    politicalCapital: z.int().min(0),
    nextElection: IsoDate.nullable(),
    activeEffects: z
      .array(z.strictObject({ effectId: EffectId, label: z.string(), actor: CountryId, turnsLeft: z.int().nullable() }))
      .max(LIMITS.activeEffects)
  }),
  world: z
    .array(z.strictObject({ id: CountryId, name: z.string(), regime: Regime, bars: Bars }))
    .max(LIMITS.worldCountries),
  recentEvents: z
    .array(z.strictObject({ turn: Turn, title: z.string(), summary: z.string().max(LIMITS.eventSummaryChars) }))
    .max(LIMITS.recentEvents),
  /** Dormant seeds relevant to this turn; `due` ones are ready to come back. */
  seeds: z
    .array(
      z.strictObject({
        id: z.string(),
        hook: z.string().max(LIMITS.seedHookChars),
        entities: z.array(EntityRef),
        tags: z.array(z.string()),
        due: z.boolean()
      })
    )
    .max(LIMITS.relevantSeeds),
  /** The player's free-text order, verbatim (trimmed to the limit). */
  order: z.string().min(1).max(LIMITS.orderChars)
})
export type TurnRequest = z.infer<typeof TurnRequest>

// ── LLM → code ──────────────────────────────────────────────────────────────

const Reason = z.string().min(1).max(LIMITS.reasonChars)

/** One thing the player's government does: a catalog id plus a target. No numbers. */
export const ProposedChange = z.strictObject({
  effectId: EffectId,
  target: EntityRef,
  reason: Reason
})
export type ProposedChange = z.infer<typeof ProposedChange>

/** Another country acting this turn, again only as a catalog id plus a target. */
export const ForeignIntent = z.strictObject({
  actor: CountryId,
  effectId: EffectId,
  target: EntityRef,
  reason: Reason
})
export type ForeignIntent = z.infer<typeof ForeignIntent>

/** A consequence to remember for later. Code decides when it wakes and whether it fires. */
export const SeedProposal = z.strictObject({
  hook: z.string().min(1).max(LIMITS.seedHookChars),
  entities: z.array(EntityRef).min(1).max(4),
  /** Free words; code normalises them into tags. */
  tags: z.array(z.string().min(1).max(40)).max(5),
  dormancy: Dormancy,
  likelihood: Likelihood,
  condition: SeedCondition.nullable()
})
export type SeedProposal = z.infer<typeof SeedProposal>

export const Narration = z.strictObject({
  headline: z.string().min(1).max(120),
  body: z.string().min(1).max(1500)
})
export type Narration = z.infer<typeof Narration>

export const ChangeList = z.strictObject({
  /** How the order was understood, in one or two sentences. */
  interpretation: z.string().min(1).max(400),
  changes: z.array(ProposedChange).max(LIMITS.changes),
  foreignIntents: z.array(ForeignIntent).max(LIMITS.foreignIntents),
  newSeeds: z.array(SeedProposal).max(LIMITS.newSeeds),
  narration: Narration
})
export type ChangeList = z.infer<typeof ChangeList>

declare const approved: unique symbol
/** A ChangeList the referee accepted. Only `reviewChangeList` produces one. */
export type ApprovedChangeList = ChangeList & { readonly [approved]: true }

// ── turn loop ───────────────────────────────────────────────────────────────

export interface TurnAction {
  /** The player's order as typed. */
  order: string
  changes: ApprovedChangeList
}

export interface TurnOutcome {
  newState: GameState
  /** New history lines to append to the event log. */
  events: GameEvent[]
  /** Seeds planted this turn. */
  seeds: Seed[]
  narration: Narration
}

