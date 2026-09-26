import { describe, expect, it } from 'vitest'
import { proposeValidateRepair } from '../../src/engine/loop'
import { createNewGame } from '../../src/engine/new-game'
import { formatIssuesForRepair, reviewChangeList, type IssueCode } from '../../src/engine/referee'
import { applyTurn } from '../../src/engine/turn'
import { VALID_CHANGES, variant, ORDER } from './fixtures'

const state = createNewGame({ gameId: 'test', seed: 7 })

function rejectCodes(raw: unknown, s = state): IssueCode[] {
  const verdict = reviewChangeList(raw, s)
  if (verdict.ok) throw new Error('expected a rejection')
  return verdict.issues.map((i) => i.code)
}

describe('referee', () => {
  it('accepts a valid hand-written ChangeList', () => {
    const verdict = reviewChangeList(VALID_CHANGES, state)
    expect(verdict.ok).toBe(true)
  })

  it('rejects an effect that is not in the catalog', () => {
    const raw = variant((c) => {
      c.changes[0] = { effectId: 'nuke_everyone' as never, target: { type: 'country', id: 'GRC' }, reason: 'x' }
    })
    const verdict = reviewChangeList(raw, state)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.issues[0]).toMatchObject({ path: 'changes[0].effectId', code: 'unknown_effect' })
      expect(verdict.issues[0]?.message).toContain('"nuke_everyone"')
    }
  })

  it('rejects raw numbers smuggled into a change', () => {
    const raw = variant((c) => {
      ;(c.changes[1] as Record<string, unknown>).amount = 500
    })
    expect(rejectCodes(raw)).toEqual(['extra_field'])
  })

  it('enforces catalog rules: EU membership needs an accession bid first', () => {
    const raw = variant((c) => {
      c.changes = [{ effectId: 'eu_membership', target: { type: 'country', id: 'TUR' }, reason: 'x' }]
    })
    expect(rejectCodes(raw)).toEqual(['rule_failed'])
  })

  it("stops the player from using another country's moves", () => {
    const raw = variant((c) => {
      c.changes = [{ effectId: 'energy_cutoff', target: { type: 'country', id: 'GRC' }, reason: 'x' }]
    })
    expect(rejectCodes(raw)).toEqual(['actor_not_allowed'])
  })

  it('rejects targets that do not exist or have the wrong type', () => {
    expect(
      rejectCodes(
        variant((c) => {
          c.changes[1] = { effectId: 'trade_agreement', target: { type: 'country', id: 'ATL' }, reason: 'Atlantis' }
        })
      )
    ).toEqual(['unknown_target'])
    expect(
      rejectCodes(
        variant((c) => {
          c.changes = [{ effectId: 'regional_investment', target: { type: 'country', id: 'TUR' }, reason: 'x' }]
        })
      )
    ).toEqual(['wrong_target_type'])
    expect(
      rejectCodes(
        variant((c) => {
          c.changes = [{ effectId: 'regional_investment', target: { type: 'province', id: 'GR-I' }, reason: 'x' }]
        })
      )
    ).toEqual(['rule_failed'])
  })

  it('caps a turn by political capital (no god mode)', () => {
    const raw = variant((c) => {
      c.changes = [
        { effectId: 'fiscal_stimulus', target: { type: 'country', id: 'TUR' }, reason: 'x' },
        { effectId: 'military_buildup', target: { type: 'country', id: 'TUR' }, reason: 'y' }
      ]
    })
    expect(rejectCodes(raw)).toEqual(['over_budget'])
  })

  it('rejects duplicates, self-targeted bilateral moves and player-as-foreign', () => {
    expect(rejectCodes(variant((c) => void c.changes.push({ ...c.changes[1]! })))).toContain('duplicate')
    expect(
      rejectCodes(
        variant((c) => {
          c.foreignIntents = [{ actor: 'TUR', effectId: 'sanctions', target: { type: 'country', id: 'GRC' }, reason: 'x' }]
        })
      )
    ).toEqual(['actor_is_player'])
    expect(
      rejectCodes(
        variant((c) => {
          c.foreignIntents = [{ actor: 'RUS', effectId: 'sanctions', target: { type: 'country', id: 'RUS' }, reason: 'x' }]
        })
      )
    ).toEqual(['rule_failed'])
  })

  it('rejects seeds about entities that do not exist', () => {
    const raw = variant((c) => {
      c.newSeeds[0]!.entities = [{ type: 'country', id: 'XYZ' }]
    })
    expect(rejectCodes(raw)).toEqual(['unknown_entity'])
  })

  it('knows what is already in effect', () => {
    const verdict = reviewChangeList(VALID_CHANGES, state)
    if (!verdict.ok) throw new Error('setup')
    const after = applyTurn(state, { order: ORDER, changes: verdict.changes }).newState
    after.politicalCapital.current = 6
    // Bid is active now, so membership is allowed; a second bid is not.
    const membership = variant((c) => {
      c.changes = [{ effectId: 'eu_membership', target: { type: 'country', id: 'TUR' }, reason: 'x' }]
      c.foreignIntents = []
      c.newSeeds = []
    })
    expect(reviewChangeList(membership, after).ok).toBe(true)
    expect(
      rejectCodes(
        variant((c) => {
          c.changes = [c.changes[0]!]
          c.foreignIntents = []
        }),
        after
      )
    ).toEqual(['already_active'])
  })

  it('writes repair feedback the LLM can act on', () => {
    const verdict = reviewChangeList(variant((c) => ((c.changes[1] as Record<string, unknown>).amount = 500)), state)
    if (verdict.ok) throw new Error('expected rejection')
    const text = formatIssuesForRepair(verdict.issues)
    expect(text).toContain('changes[1]')
    expect(text).toContain('numbers are computed by the game')
  })
})

describe('propose → validate → repair', () => {
  it('sends the objections back and accepts the corrected proposal', async () => {
    const feedbacks: Array<string | null> = []
    const answers = [variant((c) => void (c.changes[0]!.effectId = 'nuke_everyone' as never)), VALID_CHANGES]
    const result = await proposeValidateRepair(async (feedback) => {
      feedbacks.push(feedback)
      return answers.shift()
    }, state)

    expect(result).toMatchObject({ ok: true, attempts: 2 })
    expect(feedbacks[0]).toBeNull()
    expect(feedbacks[1]).toContain('nuke_everyone')
  })

  it('gives up after the attempt limit and nothing is applied', async () => {
    const result = await proposeValidateRepair(async () => ({ garbage: true }), state, 3)
    expect(result.ok).toBe(false)
    expect(result.attempts).toBe(3)
  })
})
