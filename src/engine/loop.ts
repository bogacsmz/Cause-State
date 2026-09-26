import type { ApprovedChangeList } from '@shared/game/contract'
import type { GameState } from '@shared/game/schema'
import { formatIssuesForRepair, reviewChangeList, type RefereeIssue, type ReviewContext } from './referee'

/**
 * Asks for a proposal. `feedback` is null on the first attempt; on a repair attempt it
 * carries the referee's objections to the previous proposal.
 */
export type Proposer = (feedback: string | null) => Promise<unknown>

export type LoopResult =
  | { ok: true; changes: ApprovedChangeList; attempts: number }
  | { ok: false; issues: RefereeIssue[]; attempts: number }

/**
 * Propose → validate → repair: the heart of the AI turn. The LLM proposes a ChangeList,
 * the referee checks it, and any objections go back for a bounded number of repairs.
 * Nothing touches the world until the referee approves.
 */
export async function proposeValidateRepair(
  propose: Proposer,
  state: GameState,
  ctx: ReviewContext = {},
  maxAttempts = 3
): Promise<LoopResult> {
  let feedback: string | null = null
  let last: RefereeIssue[] = []

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const verdict = reviewChangeList(await propose(feedback), state, ctx)
    if (verdict.ok) return { ok: true, changes: verdict.changes, attempts: attempt }
    last = verdict.issues
    feedback = formatIssuesForRepair(verdict.issues)
  }
  return { ok: false, issues: last, attempts: maxAttempts }
}
