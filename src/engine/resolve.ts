import type { TurnOutcome } from '@shared/game/contract'
import type { GameState, Seed } from '@shared/game/schema'
import { proposeValidateRepair, type Proposer } from './loop'
import type { RefereeIssue } from './referee'
import { scriptedChangeList, type Decision } from './scripted-ai'
import { planSeeds } from './seeds'
import { applyTurn } from './turn'

export interface TurnInput {
  /** Catalog decisions the player picked (cards or interpreted orders). */
  decisions: readonly Decision[]
  /** What the player typed this turn, for the record and the AI. */
  orders: readonly string[]
  /** Dormant seeds that might wake (store query: due seeds). */
  candidateSeeds: readonly Seed[]
}

export type TurnResolution =
  | { ok: true; outcome: TurnOutcome; attempts: number }
  | { ok: false; issues: RefereeIssue[]; attempts: number }

/**
 * One full turn: the code picks which seeds fire → the AI proposes a ChangeList →
 * the referee approves it (with repairs) → the code applies it. Phase 1 uses the
 * scripted AI; phase 2 passes a proposer backed by Claude.
 */
export async function resolveTurn(state: GameState, input: TurnInput, proposer?: Proposer): Promise<TurnResolution> {
  const plan = planSeeds(state, input.candidateSeeds)
  const propose: Proposer =
    proposer ?? (async () => scriptedChangeList(state, { decisions: input.decisions, orders: input.orders, plan }))

  const result = await proposeValidateRepair(propose, state, { firingSeeds: plan.firing })
  if (!result.ok) return result
  const outcome = applyTurn(state, { order: input.orders.join('\n'), changes: result.changes, plan })
  return { ok: true, outcome, attempts: result.attempts }
}
