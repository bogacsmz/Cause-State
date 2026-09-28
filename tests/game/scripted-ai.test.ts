import { describe, expect, it } from 'vitest'
import { happeningsFrom, type Happening } from '../../src/engine/director'
import { createNewGame } from '../../src/engine/new-game'
import { resolveTurn } from '../../src/engine/resolve'
import { reviewChangeList } from '../../src/engine/referee'
import { interpretOrder, scriptedChangeList, type Decision } from '../../src/engine/scripted-ai'
import { decisionOptions } from '../../src/engine/view'
import type { GameEvent, GameState, Seed } from '../../src/shared/game/schema'

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
    let past: Happening[] = []
    const fired: string[] = []
    const events: GameEvent[] = []
    for (let t = 0; t < turns && state.status === 'playing'; t++) {
      const res = await resolveTurn(state, { decisions: decide(state, t), orders: [], candidateSeeds: seeds, past })
      if (!res.ok) throw new Error(JSON.stringify(res.issues))
      const { outcome } = res
      expect(res.attempts).toBe(1)
      const updated = new Map(outcome.seedUpdates.map((s) => [s.id, s]))
      seeds = [...seeds.map((s) => updated.get(s.id) ?? s), ...outcome.seeds]
      past = [...happeningsFrom(outcome.events), ...past]
      fired.push(...outcome.report.firedSeeds.map((f) => f.effectId))
      events.push(...outcome.events)
      state = outcome.newState
    }
    return { state, seeds, fired, events }
  }

  it('a crackdown comes back as protests within a few turns, told as news with where it came from', async () => {
    const { seeds, events } = await play((_s, t) => (t === 0 ? [{ effectId: 'press_crackdown', target: { type: 'country', id: 'TUR' } }] : []), 12)
    expect(seeds[0]).toMatchObject({ sourceEffectId: 'press_crackdown' })
    const back = events.find((e) => e.kind === 'seed_fired' && e.seedId === seeds[0]!.id)!
    // Its own headline, no label; the story says where it came from.
    expect(back.title).toBe('Susturulan öfke sokaklara taştı')
    expect(back.summary).toMatch(/Tur 1'de basına uyguladığın baskı/)
    expect(back.tags).toEqual(expect.arrayContaining(['gelisme', 'ton-kriz']))
  })

  it('the world brings developments of its own, in the tone the director planned', async () => {
    let developments = 0
    const tones = new Set<string>()
    for (let i = 0; i < 10; i++) {
      let state = createNewGame({ gameId: `world-${i}`, seed: i })
      let past: Happening[] = []
      for (let t = 0; t < 15 && state.status === 'playing'; t++) {
        const res = await resolveTurn(state, { decisions: [], orders: [], candidateSeeds: [], past })
        if (!res.ok) throw new Error(JSON.stringify(res.issues))
        const { outcome, plan } = res
        const event = outcome.events.find((e) => e.kind === 'development')
        expect(Boolean(event)).toBe(Boolean(plan.beat))
        if (event && plan.beat) {
          developments++
          tones.add(plan.beat.tone)
          expect(event.title).not.toMatch(/Kelebek|Dünya gündemi/)
          expect(event.tags).toContain('gelisme')
        }
        past = [...happeningsFrom(outcome.events), ...past]
        state = outcome.newState
      }
    }
    // Calm months are the norm: something in roughly a third of them, never every month.
    expect(developments).toBeGreaterThan(25)
    expect(developments).toBeLessThan(80)
    expect([...tones].sort()).toEqual(['good', 'neutral', 'opportunity', 'trouble'])
  })

  it('a consequence Claude planted with a long story still passes when the scripted rules tell it (Claude unreachable)', () => {
    const state = createNewGame({ gameId: 'uzun-kanca', seed: 1 })
    const hook = `Tur 3'te basına uygulanan baskının ardından ${'kapatılan kanalların muhabirleri sosyal medyada yeniden örgütleniyor; '.repeat(4)}`.slice(0, 300)
    const seed: Seed = {
      id: 'sd-000009',
      plantedTurn: 3,
      wakeTurn: 1,
      originEventId: 'ev-000001',
      sourceEffectId: 'press_crackdown',
      hook,
      entities: [{ type: 'country', id: 'TUR' }],
      tags: ['muhabirler'],
      likelihood: 'likely',
      condition: null,
      status: 'dormant',
      firedTurn: null
    }
    const plan = { firing: [seed], fizzled: [], beat: null, seedScale: 'major' as const }
    const list = scriptedChangeList(state, { decisions: [], orders: [], plan })
    expect(reviewChangeList(list, state, { firingSeeds: [seed], beat: null, seedScale: 'major' }).ok).toBe(true)
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
