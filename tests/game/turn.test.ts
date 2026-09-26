import { describe, expect, it } from 'vitest'
import { EFFECTS } from '../../src/shared/game/catalog'
import { ChangeList } from '../../src/shared/game/contract'
import { GameEvent, GameState, Seed } from '../../src/shared/game/schema'
import { approvalTarget, coupChance, DYNAMICS } from '../../src/engine/dynamics'
import { createNewGame } from '../../src/engine/new-game'
import { reviewChangeList } from '../../src/engine/referee'
import { DORMANCY_TURNS, planSeeds } from '../../src/engine/seeds'
import { applyTurn } from '../../src/engine/turn'
import { normalizeTag } from '../../src/engine/util'
import { NO_SEEDS, ORDER, VALID_CHANGES } from './fixtures'

const EMPTY: ChangeList = {
  interpretation: 'Bu tur yeni karar yok.',
  changes: [],
  foreignIntents: [],
  newSeeds: [],
  seedOutcomes: [],
  narration: { headline: 'Sessiz bir ay', body: 'Bir şey olmadı.' }
}

function approve(state: GameState, list: ChangeList, firing: Seed[] = []) {
  const verdict = reviewChangeList(list, state, { firingSeeds: firing })
  if (!verdict.ok) throw new Error(JSON.stringify(verdict.issues))
  return verdict.changes
}

function quietTurn(state: GameState) {
  return applyTurn(state, { order: '', changes: approve(state, EMPTY), plan: NO_SEEDS })
}

const player = (s: GameState) => s.countries.find((c) => c.id === s.playerCountryId)!

describe('new game', () => {
  it('is a valid GameState with Türkiye as the player and an election in 12 turns', () => {
    const state = createNewGame({ gameId: 'g1' })
    expect(GameState.safeParse(state).success).toBe(true)
    expect(state).toMatchObject({ playerCountryId: 'TUR', turn: 0, status: 'playing', effects: [] })
    expect(state.election).toMatchObject({ nextTurn: 12, threshold: 50 })
    expect(state.politicalCapital).toEqual({ current: 3, perTurn: 3, max: 3 })
    expect(player(state).nextElection).toBe('2027-01-01')
  })

  it('refuses a state whose references point nowhere', () => {
    const state = createNewGame({ gameId: 'g1' })
    state.provinces[0]!.owner = 'ATL'
    expect(GameState.safeParse(state).success).toBe(false)
  })
})

describe('applyTurn', () => {
  it('turns approved changes into effects whose numbers come from the catalog', () => {
    const state = createNewGame({ gameId: 'test', seed: 42 })
    const { newState, report } = applyTurn(state, { order: ORDER, changes: approve(state, VALID_CHANGES), plan: NO_SEEDS })

    expect(newState.turn).toBe(1)
    expect(newState.date).toBe('2026-02-01')
    expect(report.capital).toEqual({ spent: 2, next: 3 })
    expect(GameState.safeParse(newState).success).toBe(true)

    const trade = newState.effects.find((e) => e.effectId === 'trade_agreement')
    expect(trade).toMatchObject({
      actor: 'TUR',
      target: { type: 'country', id: 'GRC' },
      source: 'player',
      expiresTurn: 1 + EFFECTS.trade_agreement.durationTurns!
    })
    // Each modifier lands on the right country with the catalog's number.
    expect(trade?.modifiers).toEqual(
      EFFECTS.trade_agreement.modifiers.map((m) => ({ country: m.on === 'actor' ? 'TUR' : 'GRC', bar: m.bar, delta: m.delta, mode: m.mode }))
    )
    // A one-turn protest note is gone again after the turn.
    expect(newState.effects.some((e) => e.effectId === 'diplomatic_protest')).toBe(false)
  })

  it('moves bars by the effects and explains every change', () => {
    const state = createNewGame({ gameId: 'test', seed: 42 })
    const tax: ChangeList = {
      ...EMPTY,
      changes: [{ effectId: 'tax_cut', target: { type: 'country', id: 'TUR' }, reason: 'x' }]
    }
    const { newState, report } = applyTurn(state, { order: 'vergileri indir', changes: approve(state, tax), plan: NO_SEEDS })
    const approval = report.bars.find((b) => b.bar === 'approval')!

    expect(approval.causes).toContainEqual(expect.objectContaining({ label: 'Vergi indirimi', delta: 5, kind: 'effect' }))
    const sum = approval.causes.reduce((n, c) => n + c.delta, 0)
    expect(approval.after - approval.before).toBe(sum)
    expect(player(newState).bars.approval).toBe(approval.after)

    // 'once' hits one time; 'per_turn' keeps going until the effect ends.
    const later = quietTurn(newState).report
    expect(later.bars.find((b) => b.bar === 'approval')!.causes.some((c) => c.label === 'Vergi indirimi')).toBe(false)
    expect(later.bars.find((b) => b.bar === 'welfare')!.causes).toContainEqual(
      expect.objectContaining({ label: 'Vergi indirimi', delta: 1 })
    )
    expect(later.bars.find((b) => b.bar === 'economy')!.causes).toContainEqual(
      expect.objectContaining({ label: 'Vergi indirimi', delta: -1 })
    )
  })

  it('ends effects after their duration', () => {
    let state = createNewGame({ gameId: 'test', seed: 1 })
    const tax: ChangeList = { ...EMPTY, changes: [{ effectId: 'tax_cut', target: { type: 'country', id: 'TUR' }, reason: 'x' }] }
    state = applyTurn(state, { order: '', changes: approve(state, tax), plan: NO_SEEDS }).newState
    // Active for exactly durationTurns turns (the turn it started counts).
    const duration = EFFECTS.tax_cut.durationTurns!
    for (let t = 2; t < duration; t++) state = quietTurn(state).newState
    expect(state.effects.map((e) => e.effectId)).toEqual(['tax_cut'])
    const last = quietTurn(state)
    expect(last.newState.effects).toEqual([])
    expect(last.report.expired).toEqual(['Vergi indirimi'])
  })

  it('writes a history with a cause chain and a hidden seed', () => {
    const state = createNewGame({ gameId: 'test', seed: 42 })
    const { events, seeds } = applyTurn(state, { order: ORDER, changes: approve(state, VALID_CHANGES), plan: NO_SEEDS })

    events.forEach((e) => expect(GameEvent.safeParse(e).success).toBe(true))
    const order = events[0]!
    expect(order.kind).toBe('order')
    expect(events.map((e) => e.kind)).toEqual([
      'order',
      'effect_applied',
      'effect_applied',
      'foreign_action',
      'seed_planted',
      'narration'
    ])
    expect(events.find((e) => e.kind === 'seed_planted')?.visibility).toBe('hidden')

    const seed = seeds[0]!
    expect(Seed.safeParse(seed).success).toBe(true)
    expect(seed).toMatchObject({ sourceEffectId: 'eu_accession_bid', tags: ['ab', 'veto-tehdidi'], status: 'dormant' })
    const [min, max] = DORMANCY_TURNS.medium
    expect(seed.wakeTurn).toBeGreaterThanOrEqual(1 + min)
    expect(seed.wakeTurn).toBeLessThanOrEqual(1 + max)
  })

  it('fires a planned seed: the outcome becomes an effect tied to the original decision', () => {
    const state = createNewGame({ gameId: 'test', seed: 42 })
    const first = applyTurn(state, { order: ORDER, changes: approve(state, VALID_CHANGES), plan: NO_SEEDS })
    const seed = { ...first.seeds[0]!, wakeTurn: 2 }
    const plan = { firing: [seed], fizzled: [] }

    const list: ChangeList = {
      ...EMPTY,
      seedOutcomes: [
        { seedId: seed.id, actor: 'FRA', effectId: 'eu_process_frozen', target: { type: 'country', id: 'TUR' }, reason: 'Paris vetoyu çekti.' }
      ]
    }
    const second = applyTurn(first.newState, { order: '', changes: approve(first.newState, list, [seed]), plan })

    const fired = second.events.find((e) => e.kind === 'seed_fired')!
    expect(fired.causeId).toBe(first.events[0]!.id)
    expect(fired.seedId).toBe(seed.id)
    expect(second.seedUpdates).toEqual([{ ...seed, status: 'fired', firedTurn: 2 }])
    expect(second.report.firedSeeds).toEqual([
      { seedId: seed.id, plantedTurn: 1, effectId: 'eu_process_frozen', source: 'eu_accession_bid', origin: 'AB üyelik başvurusu' }
    ])
    const frozen = second.newState.effects.find((e) => e.effectId === 'eu_process_frozen')
    expect(frozen).toMatchObject({ actor: 'FRA', source: 'foreign', seedId: seed.id })
    // The referee now blocks membership while the process is frozen.
    const membership: ChangeList = { ...EMPTY, changes: [{ effectId: 'eu_membership', target: { type: 'country', id: 'TUR' }, reason: 'x' }] }
    expect(reviewChangeList(membership, second.newState).ok).toBe(false)
  })

  it('holds an election on schedule: win keeps you in power, loss ends the game', () => {
    const base = { ...createNewGame({ gameId: 'e', seed: 3 }), turn: 11 }
    const popular = structuredClone(base)
    player(popular).bars.approval = 80
    const won = quietTurn(popular)
    expect(won.report.election?.won).toBe(true)
    expect(won.newState).toMatchObject({ status: 'playing', election: { nextTurn: 24 } })

    const hated = structuredClone(base)
    player(hated).bars.approval = 20
    const lost = quietTurn(hated)
    expect(lost.report.election?.won).toBe(false)
    expect(lost.newState).toMatchObject({ status: 'lost', ending: { kind: 'election_lost', turn: 12 } })
    expect(() => quietTurn(lost.newState)).toThrow()
  })

  it('can end in a coup when stability collapses', () => {
    expect(coupChance(DYNAMICS.coupThreshold)).toBe(0)
    expect(coupChance(DYNAMICS.coupThreshold - 6)).toBeCloseTo(6 * DYNAMICS.coupChancePerPoint)
    let coups = 0
    for (let seed = 0; seed < 40; seed++) {
      const state = createNewGame({ gameId: 'c', seed })
      player(state).bars.stability = 5
      player(state).bars.approval = 10
      player(state).bars.welfare = 10
      const out = quietTurn(state)
      if (out.newState.ending?.kind === 'coup') coups++
    }
    expect(coups).toBeGreaterThan(25)
  })

  it('lets approval drift toward what welfare, economy and stability justify', () => {
    const state = createNewGame({ gameId: 'd', seed: 5 })
    const target = approvalTarget(player(state).bars, 1)
    const out = quietTurn(state)
    const drift = out.report.bars.find((b) => b.bar === 'approval')!.causes.find((c) => c.kind === 'drift')
    expect(Math.sign(drift?.delta ?? 0)).toBe(Math.sign(target - player(state).bars.approval))
  })

  it('is deterministic and never mutates its input', () => {
    const state = createNewGame({ gameId: 'test', seed: 42 })
    const before = structuredClone(state)
    const changes = approve(state, VALID_CHANGES)
    const a = applyTurn(state, { order: ORDER, changes, plan: NO_SEEDS })
    const b = applyTurn(state, { order: ORDER, changes, plan: NO_SEEDS })
    expect(a).toEqual(b)
    expect(state).toEqual(before)
  })
})

describe('planSeeds', () => {
  const seed = (over: Partial<Seed>): Seed => ({
    id: 'sd-1',
    plantedTurn: 1,
    wakeTurn: 3,
    originEventId: 'ev-1',
    sourceEffectId: 'press_crackdown',
    hook: 'x',
    entities: [{ type: 'country', id: 'TUR' }],
    tags: ['baski-birikimi'],
    likelihood: 'likely',
    condition: null,
    status: 'dormant',
    firedTurn: null,
    ...over
  })

  it('never fires a seed before it wakes, and lets overdue seeds fade', () => {
    const state = { ...createNewGame({ gameId: 'p' }), turn: 1 }
    expect(planSeeds(state, [seed({ wakeTurn: 5 })])).toEqual({ firing: [], fizzled: [] })
    const late = { ...state, turn: 20 }
    expect(planSeeds(late, [seed({ wakeTurn: 3 })]).fizzled).toHaveLength(1)
  })

  it('fires likely seeds most of the time once awake, and respects conditions', () => {
    let fired = 0
    for (let t = 3; t < 43; t++) {
      const state = { ...createNewGame({ gameId: `p${t}` }), turn: t - 1 }
      if (planSeeds(state, [seed({ wakeTurn: t })]).firing.length) fired++
    }
    expect(fired).toBeGreaterThan(20)

    const calm = { ...createNewGame({ gameId: 'p' }), turn: 5 }
    const conditional = seed({ condition: { kind: 'bar_low', country: 'TUR', bar: 'stability' } })
    expect(planSeeds(calm, [conditional]).firing).toEqual([])
  })
})

describe('normalizeTag', () => {
  it('makes Turkish free text into stable ASCII tags', () => {
    expect(normalizeTag('Basın Özgürlüğü')).toBe('basin-ozgurlugu')
    expect(normalizeTag('  AB  ')).toBe('ab')
    expect(normalizeTag('!!!')).toBeNull()
  })
})
