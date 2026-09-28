import { EFFECTS } from '@shared/game/catalog'
import { ChangeList, LIMITS, type ApprovedChangeList, type Narration, type SeedPlan, type TurnOutcome } from '@shared/game/contract'
import type { GameState, Seed } from '@shared/game/schema'
import { planMonth, type Happening } from './director'
import { proposeValidateRepair, type Proposer } from './loop'
import { fitToPlan, type RefereeIssue, type ReviewContext } from './referee'
import { scriptedChangeList, type Decision } from './scripted-ai'
import { findCountry } from './lookup'
import { applyTurn } from './turn'
import { fitText, truncate } from './util'

export interface TurnInput {
  /** Catalog decisions the player picked (cards or interpreted orders), with a reason when one was recorded. */
  decisions: readonly (Decision & { reason?: string })[]
  /** What the player typed this turn, for the record and the AI. */
  orders: readonly string[]
  /** Dormant seeds that might wake (store query: due seeds). */
  candidateSeeds: readonly Seed[]
  /** Recent developments and consequences (store query), so the month's pacing knows what came before. */
  past?: readonly Happening[]
}

/** Builds the proposer once the code knows what the month holds. */
export type ProposerFactory = (plan: SeedPlan) => Proposer

export type TurnResolution =
  | { ok: true; outcome: TurnOutcome; attempts: number; changes: ApprovedChangeList; plan: SeedPlan }
  | { ok: false; issues: RefereeIssue[]; attempts: number; plan: SeedPlan }

/**
 * One full turn: the code plans the month (which seeds fire, whether the world brings a
 * development and in which tone) → the AI proposes a ChangeList → it is cut to the month's
 * size → the referee approves it (with repairs) → the code applies it. Without a proposer
 * the scripted AI proposes; Claude plugs in through `makeProposer`.
 */
export async function resolveTurn(state: GameState, input: TurnInput, makeProposer?: ProposerFactory): Promise<TurnResolution> {
  const plan = planMonth(state, input.candidateSeeds, input.past ?? [])
  const ctx: ReviewContext = {
    firingSeeds: plan.firing,
    beat: plan.beat ?? null,
    seedScale: plan.seedScale ?? 'minor',
    ...(plan.seedTone ? { seedTone: plan.seedTone } : {})
  }
  const raw: Proposer =
    makeProposer?.(plan) ?? (async () => scriptedChangeList(state, { decisions: input.decisions, orders: input.orders, plan }))
  // What is only too big is cut down to the month's size; everything else goes to the referee as is.
  const propose: Proposer = async (feedback) => {
    const proposal = await raw(feedback)
    const parsed = ChangeList.safeParse(proposal)
    return parsed.success ? fitToPlan(parsed.data, state, ctx) : proposal
  }

  let result = await proposeValidateRepair(propose, state, ctx)
  // The scripted rules must never stop the game: if even their proposal fails, the month
  // passes plainly (the decisions, consequences told as a story, nothing else).
  if (!result.ok && !makeProposer) result = await proposeValidateRepair(async () => plainMonth(state, input, plan), state, ctx, 1)
  if (!result.ok) return { ...result, plan }
  const outcome = applyTurn(state, { order: input.orders.join('\n'), changes: result.changes, plan })
  return { ok: true, outcome, attempts: result.attempts, changes: result.changes, plan }
}

/** The last resort: only what the player decided, and consequences told without an effect. */
function plainMonth(state: GameState, input: TurnInput, plan: SeedPlan): ChangeList {
  return {
    interpretation: 'Sade bir ay.',
    changes: input.decisions.map((d) => ({ effectId: d.effectId, target: d.target, reason: fitText(d.reason ?? EFFECTS[d.effectId].label, LIMITS.reasonChars) })),
    foreignIntents: [],
    newSeeds: [],
    seedOutcomes: plan.firing.map((s) => ({ seedId: s.id, actor: null, effectId: null, target: null, reason: fitText(s.hook, LIMITS.reasonChars), title: 'Geçmişin yankısı' })),
    developments: [],
    narration: { headline: `${findCountry(state, state.playerCountryId)?.name ?? 'Ankara'}'da sakin bir ay`, body: 'Bu ay gündem sakin geçti.' }
  }
}

/**
 * Swaps in the final news text, written after the code applied the turn so it can report
 * what really happened. Only the narration line changes; every number stays as applied.
 */
export function withNarration(outcome: TurnOutcome, narration: Narration): TurnOutcome {
  return {
    ...outcome,
    narration,
    events: outcome.events.map((e) =>
      e.kind === 'narration' ? { ...e, title: truncate(narration.headline, 160), summary: truncate(narration.body, 2000) } : e
    )
  }
}
