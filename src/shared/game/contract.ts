import { z } from 'zod'
import { EffectId } from './catalog'
import { Impact, Lasts, MAX_IMPACTS, type Beat, type ConsequenceTone, type Scale } from './impacts'
import { Bars, CountryId, EntityRef, IsoDate, Turn } from './primitives'
import { Dormancy, Likelihood, Regime, SeedCondition, type GameEvent, type GameState, type Seed, type TurnReport } from './schema'

// The contract between code and the LLM, both directions:
//   code → LLM:  TurnRequest  (compact, bounded context)
//   LLM → code:  ChangeList   (a proposal; the referee decides what becomes real)

/** Hard caps that keep every turn's context the same size at turn 5 and at turn 500. */
export const LIMITS = {
  orderChars: 1500,
  changes: 4,
  /** Other countries act sparingly: at most this many moves a month. */
  foreignIntents: 2,
  /** Delayed consequences planted per month: only decisions with a real story in them. */
  newSeeds: 2,
  /** At most one delayed consequence comes back in a month; calm months are normal. */
  seedOutcomes: 1,
  firingSeeds: 1,
  /** At most one development of the world's own per month (the code decides whether there is one). */
  developments: 1,
  titleChars: 90,
  reasonChars: 300,
  seedHookChars: 300,
  activeEffects: 10,
  worldCountries: 12,
  recentEvents: 12,
  eventSummaryChars: 280,
  relevantSeeds: 8,
  /** World-book entries sent per request: only the countries this turn is about. */
  worldBookEntries: 4,
  /** Running arrangements listed per country ("trade_agreement TUR→DEU"). */
  ties: 4
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
    election: z.strictObject({ turnsLeft: z.int().min(0), threshold: z.int() }),
    activeEffects: z
      .array(
        z.strictObject({
          effectId: EffectId,
          label: z.string(),
          actor: CountryId,
          target: EntityRef,
          turnsLeft: z.int().nullable()
        })
      )
      .max(LIMITS.activeEffects)
  }),
  world: z
    .array(
      z.strictObject({
        id: CountryId,
        name: z.string(),
        regime: Regime,
        bars: Bars,
        /** Running arrangements between this country and the player, e.g. "trade_agreement TUR→DEU (3 turns left)". */
        ties: z.array(z.string()).max(LIMITS.ties)
      })
    )
    .max(LIMITS.worldCountries),
  /** The frozen world book's entries for the countries this turn is about. */
  worldBook: z
    .array(
      z.strictObject({
        id: CountryId,
        stance: z.enum(['ally', 'partner', 'rival', 'wary', 'hostile']),
        agenda: z.string(),
        onTurkey: z.string(),
        levers: z.array(EffectId)
      })
    )
    .max(LIMITS.worldBookEntries),
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
  /**
   * Seeds the code decided fire this turn. Each one needs exactly one entry in the
   * ChangeList's seedOutcomes: the LLM decides what it turns into, the code decided when.
   */
  firingSeeds: z
    .array(
      z.strictObject({
        id: z.string(),
        plantedTurn: Turn,
        hook: z.string().max(LIMITS.seedHookChars),
        entities: z.array(EntityRef),
        tags: z.array(z.string())
      })
    )
    .max(LIMITS.firingSeeds),
  /** Decisions the player's government has already committed to this month (approved by the referee). */
  decisions: z
    .array(z.strictObject({ effectId: EffectId, label: z.string(), target: EntityRef, reason: z.string() }))
    .max(LIMITS.changes),
  /** The player's free-text order(s), verbatim (trimmed to the limit); empty when nothing was typed. */
  order: z.string().max(LIMITS.orderChars)
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
  /** Which of this turn's changes the seed stems from, if any. */
  source: EffectId.nullable(),
  hook: z.string().min(1).max(LIMITS.seedHookChars),
  entities: z.array(EntityRef).min(1).max(4),
  /** Free words; code normalises them into tags. */
  tags: z.array(z.string().min(1).max(40)).max(5),
  dormancy: Dormancy,
  likelihood: Likelihood,
  condition: SeedCondition.nullable()
})
export type SeedProposal = z.infer<typeof SeedProposal>

/**
 * What a fired seed turns into. actor null = society or the world itself (protests, markets).
 * effectId and target null = it plays out in the story only, with no mechanical effect.
 */
export const SeedOutcome = z.strictObject({
  seedId: z.string().min(1),
  actor: CountryId.nullable(),
  effectId: EffectId.nullable(),
  target: EntityRef.nullable(),
  reason: Reason,
  /** Its own headline ("Sansürün faturası meydanlarda"); the catalog label when missing. */
  title: z.string().min(1).max(LIMITS.titleChars).optional(),
  /** An improvised shape instead of (or on top of) the catalog move; lands on `target`, or the player. */
  impacts: z.array(Impact).max(MAX_IMPACTS).default([]),
  lasts: Lasts.default('month')
})
/** As the code reads it, defaults filled in. */
export type SeedOutcome = z.output<typeof SeedOutcome>

/**
 * Something the world brings this month on its own: the code decided that there is one and
 * in which tone (the month's Beat); the AI decides what it is. It is told as its own story and
 * lands on `target` through catalog moves done by `actor`, improvised impacts, or both;
 * with neither it is only a story.
 */
export const Development = z.strictObject({
  title: z.string().min(1).max(LIMITS.titleChars),
  story: Reason,
  /** The country behind it, or null for society, markets, nature or the world at large. */
  actor: CountryId.nullable(),
  /** Usually the player's country. */
  target: EntityRef,
  moves: z.array(EffectId).max(2),
  impacts: z.array(Impact).max(MAX_IMPACTS),
  lasts: Lasts
})
export type Development = z.infer<typeof Development>

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
  seedOutcomes: z.array(SeedOutcome).max(LIMITS.seedOutcomes),
  developments: z.array(Development).max(LIMITS.developments).default([]),
  narration: Narration
})
/** A proposal as the AI (or the scripted rules) writes it: fields with a default may be left out. */
export type ChangeList = z.input<typeof ChangeList>
/** The same list once parsed, every default filled in. */
export type ParsedChangeList = z.output<typeof ChangeList>

declare const approved: unique symbol
/** A ChangeList the referee accepted. Only `reviewChangeList` produces one. */
export type ApprovedChangeList = ParsedChangeList & { readonly [approved]: true }

// ── turn loop ───────────────────────────────────────────────────────────────

/** What the month holds, decided by code before the AI is asked anything (src/engine/director.ts). */
export interface SeedPlan {
  /** Fire now; the ChangeList must give each one an outcome. */
  firing: Seed[]
  /** Slept too long without firing; they quietly fade. */
  fizzled: Seed[]
  /** The world's own development this month, if any: its tone, size and where it starts. */
  beat?: Beat | null
  /** How big a consequence coming back this month may be. */
  seedScale?: Scale
  /** The tone it comes back in. */
  seedTone?: ConsequenceTone
}

export interface TurnAction {
  /** The player's orders as typed (may be empty). */
  order: string
  changes: ApprovedChangeList
  plan: SeedPlan
}

export interface TurnOutcome {
  newState: GameState
  /** New history lines to append to the event log. */
  events: GameEvent[]
  /** Seeds planted this turn. */
  seeds: Seed[]
  /** Existing seeds whose status changed (fired or fizzled). */
  seedUpdates: Seed[]
  narration: Narration
  report: TurnReport
}

