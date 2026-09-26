import { describe, expect, it } from 'vitest'
import { createNewGame } from '../../src/engine/new-game'
import { resolveTurn } from '../../src/engine/resolve'
import { interpretOrder, type Decision } from '../../src/engine/scripted-ai'
import { decisionOptions } from '../../src/engine/view'
import type { GameState, Seed } from '../../src/shared/game/schema'

describe('interpretOrder (scripted AI)', () => {
  const state = createNewGame({ gameId: 'i' })

  it.each([
    ['Vergileri indir', 'tax_cut', 'TUR'],
    ["Yunanistan'la ticaret anlaşması imzala", 'trade_agreement', 'GRC'],
    ["AB'ye başvur", 'eu_accession_bid', 'TUR'],
    ["İzmir'e yatırım yap", 'regional_investment', 'TR-35'],
    ['Basını sustur', 'press_crackdown', 'TUR'],
    ["Rusya'ya yaptırım uygula", 'sanctions', 'RUS'],
    ['Orduyu güçlendir, askerî yığınak yap', 'military_buildup', 'TUR']
  ])('"%s" → %s on %s', (text, effectId, targetId) => {
    const result = interpretOrder(state, text)
    expect(result.kind).toBe('decision')
    if (result.kind === 'decision') expect(result.decision).toEqual(expect.objectContaining({ effectId, target: expect.objectContaining({ id: targetId }) }))
  })

  it('answers questions for free instead of spending capital', () => {
    const result = interpretOrder(state, 'Durum nedir, ne yapmalıyız?')
    expect(result.kind).toBe('talk')
    expect(result.reply).toContain('Seçime 12 ay')
  })

  it('explains why an order cannot happen yet', () => {
    const result = interpretOrder(state, "AB'ye üye ol")
    expect(result).toEqual({ kind: 'talk', reply: expect.stringContaining('Önce "AB üyelik başvurusu" gerekli') })
  })

  it('asks for a target when a bilateral order has none', () => {
    expect(interpretOrder(state, 'Ticaret anlaşması imzala').kind).toBe('talk')
  })
})

describe('decisionOptions', () => {
  it('offers every player decision with its numbers and greys out impossible ones', () => {
    const options = decisionOptions(createNewGame({ gameId: 'o' }))
    const tax = options.find((o) => o.effectId === 'tax_cut')!
    expect(tax).toMatchObject({ available: true, cost: 1, targetKind: 'self', lines: ['Onay +5', 'Refah +1/tur', 'Ekonomi -1/tur', '4 tur'] })
    const membership = options.find((o) => o.effectId === 'eu_membership')!
    expect(membership).toMatchObject({ available: false, reason: 'Önce "AB üyelik başvurusu" gerekli.' })
    const trade = options.find((o) => o.effectId === 'trade_agreement')!
    expect(trade.targetKind).toBe('country')
    expect(trade.targets.map((t) => t.ref.id)).not.toContain('TUR')
  })
})

describe('resolveTurn: the full scripted pipeline', () => {
  async function play(decide: (s: GameState, turn: number) => Decision[], turns: number) {
    let state = createNewGame({ gameId: 'pipeline', seed: 11 })
    let seeds: Seed[] = []
    const fired: string[] = []
    for (let t = 0; t < turns && state.status === 'playing'; t++) {
      const res = await resolveTurn(state, { decisions: decide(state, t), orders: [], candidateSeeds: seeds })
      if (!res.ok) throw new Error(JSON.stringify(res.issues))
      const { outcome } = res
      expect(res.attempts).toBe(1)
      const updated = new Map(outcome.seedUpdates.map((s) => [s.id, s]))
      seeds = [...seeds.map((s) => updated.get(s.id) ?? s), ...outcome.seeds]
      fired.push(...outcome.report.firedSeeds.map((f) => f.effectId))
      state = outcome.newState
    }
    return { state, seeds, fired }
  }

  it('a crackdown comes back as a protest wave within a few turns', async () => {
    const { fired, seeds } = await play((_s, t) => (t === 0 ? [{ effectId: 'press_crackdown', target: { type: 'country', id: 'TUR' } }] : []), 12)
    expect(seeds[0]).toMatchObject({ sourceEffectId: 'press_crackdown' })
    expect(fired).toContain('protest_wave')
  })

  it('the world moves too: developments abroad are foreshadowed, then may hit', async () => {
    let foreshadowed = 0
    let hits = 0
    for (let i = 0; i < 10; i++) {
      let state = createNewGame({ gameId: `world-${i}`, seed: i })
      let seeds: Seed[] = []
      for (let t = 0; t < 15 && state.status === 'playing'; t++) {
        const res = await resolveTurn(state, { decisions: [], orders: [], candidateSeeds: seeds })
        if (!res.ok) throw new Error(JSON.stringify(res.issues))
        const { outcome } = res
        if (outcome.narration.body.includes('Dünya gündemi')) foreshadowed++
        for (const f of outcome.report.firedSeeds) {
          expect(f).toMatchObject({ source: null, origin: 'Dünya gündemi' })
          expect(outcome.events.find((e) => e.seedId === f.seedId)?.title).toMatch(/^Dünya gündemi: /)
          hits++
        }
        const updated = new Map(outcome.seedUpdates.map((s) => [s.id, s]))
        seeds = [...seeds.map((s) => updated.get(s.id) ?? s), ...outcome.seeds]
        state = outcome.newState
      }
    }
    expect(foreshadowed).toBeGreaterThan(20)
    expect(hits).toBeGreaterThan(5)
  })

  it('every scripted proposal passes the referee on the first try', async () => {
    const all: Decision['effectId'][] = ['tax_cut', 'military_buildup', 'anti_corruption_drive', 'eu_accession_bid', 'austerity']
    const { state } = await play(
      (s, t) =>
        decisionOptions(s)
          .filter((o) => o.available && o.targetKind === 'self' && all.includes(o.effectId))
          .slice(0, 3)
          .map((o) => ({ effectId: o.effectId, target: o.targets[0]!.ref }))
          .filter(() => t % 2 === 0),
      15
    )
    expect(state.turn).toBeGreaterThan(5)
  })
})
