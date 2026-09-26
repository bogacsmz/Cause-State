import type { ApprovedChangeList, Narration, SeedPlan, TurnOutcome } from '@shared/game/contract'
import type { GameState, Seed } from '@shared/game/schema'
import { proposeValidateRepair, type Proposer } from './loop'
import type { RefereeIssue } from './referee'
import { scriptedChangeList, type Decision } from './scripted-ai'
import { planSeeds } from './seeds'
import { applyTurn } from './turn'
import { truncate } from './util'

export interface TurnInput {
  /** Catalog decisions the player picked (cards or interpreted orders), with a reason when one was recorded. */
  decisions: readonly (Decision & { reason?: string })[]
  /** What the player typed this turn, for the record and the AI. */
  orders: readonly string[]
  /** Dormant seeds that might wake (store query: due seeds). */
  candidateSeeds: readonly Seed[]
}

/** Builds the proposer once the code knows which seeds fire this turn. */
export type ProposerFactory = (plan: SeedPlan) => Proposer

export type TurnResolution =
  | { ok: true; outcome: TurnOutcome; attempts: number; changes: ApprovedChangeList; plan: SeedPlan }
  | { ok: false; issues: RefereeIssue[]; attempts: number; plan: SeedPlan }

/**
 * One full turn: the code picks which seeds fire → the AI proposes a ChangeList →
 * the referee approves it (with repairs) → the code applies it. Without a proposer the
 * scripted AI proposes; Claude plugs in through `makeProposer`.
 */
export async function resolveTurn(state: GameState, input: TurnInput, makeProposer?: ProposerFactory): Promise<TurnResolution> {
  const plan = planSeeds(state, input.candidateSeeds)
  const propose: Proposer =
    makeProposer?.(plan) ?? (async () => scriptedChangeList(state, { decisions: input.decisions, orders: input.orders, plan }))

  const result = await proposeValidateRepair(propose, state, { firingSeeds: plan.firing })
  if (!result.ok) return { ...result, plan }
  const outcome = applyTurn(state, { order: input.orders.join('\n'), changes: result.changes, plan })
  return { ok: true, outcome, attempts: result.attempts, changes: result.changes, plan }
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
