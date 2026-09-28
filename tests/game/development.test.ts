import { describe, expect, it } from 'vitest'
import { ChangeList, type Development } from '../../src/shared/game/contract'
import type { Beat, Impact } from '../../src/shared/game/impacts'
import type { GameState, Seed } from '../../src/shared/game/schema'
import { createNewGame } from '../../src/engine/new-game'
import { fitToPlan, reviewChangeList, type ReviewContext } from '../../src/engine/referee'
import { applyTurn } from '../../src/engine/turn'
import { developmentWeightOn } from '../../src/engine/weight'

// The world's own developments: the AI names them and gives them a shape in words, the code
// turns the words into numbers and keeps them in the month's tone and scale.

const state = createNewGame({ gameId: 'gelisme', seed: 4 })
const TUR = { type: 'country' as const, id: 'TUR' }
const beat = (tone: Beat['tone'], scale: Beat['scale'] = 'minor'): Beat => ({ tone, scale, stage: { kind: 'home' } })
const up = (bar: Impact['bar'], size: Impact['size'] = 'small', monthly = false): Impact => ({ bar, change: 'up', size, monthly })
const down = (bar: Impact['bar'], size: Impact['size'] = 'small', monthly = false): Impact => ({ bar, change: 'down', size, monthly })

const drought: Development = {
  title: 'Konya ovasında kuraklık alarmı',
  story: 'Konya ovasında yağışlar yarıya indi; buğday üreticileri hasat kaybı bekliyor, un fiyatları şimdiden kıpırdadı.',
  actor: null,
  target: TUR,
  moves: [],
  impacts: [down('welfare', 'small', true), down('approval')],
  lasts: 'season'
}

function list(extra: Partial<ChangeList>): ChangeList {
  return {
    interpretation: 'Sakin bir ay.',
    changes: [],
    foreignIntents: [],
    newSeeds: [],
    seedOutcomes: [],
    narration: { headline: 'Ay', body: 'Haber.' },
    ...extra
  }
}

function review(l: ChangeList, ctx: ReviewContext, s: GameState = state) {
  return reviewChangeList(l, s, ctx)
}

describe('the referee keeps developments in the month’s tone and size', () => {
  it('accepts an improvised development that fits the planned tone', () => {
    expect(review(list({ developments: [drought] }), { beat: beat('trouble') }).ok).toBe(true)
  })

  it('no development when the director planned none', () => {
    const verdict = review(list({ developments: [drought] }), { beat: null })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.issues.map((i) => i.code)).toContain('unplanned')
  })

  it('good news must help, trouble must cost', () => {
    const verdict = review(list({ developments: [drought] }), { beat: beat('good') })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.issues.map((i) => i.code)).toContain('wrong_tone')
    const harvest = { ...drought, title: 'Bereketli hasat', impacts: [up('welfare', 'small', true), up('approval')] }
    expect(review(list({ developments: [harvest] }), { beat: beat('good') }).ok).toBe(true)
  })

  it('a minor development is never a shock: large words are cut down to size, not sent back', () => {
    const shock = { ...drought, impacts: [down('welfare', 'large', true), down('approval', 'large'), down('stability', 'large')] }
    const raw = list({ developments: [shock] })
    expect(review(raw, { beat: beat('trouble') }).ok).toBe(false)
    const fitted = fitToPlan(ChangeList.parse(raw), state, { beat: beat('trouble') })
    expect(review(fitted, { beat: beat('trouble') }).ok).toBe(true)
    expect(Math.abs(developmentWeightOn(state, fitted.developments[0]!, 'TUR'))).toBeLessThanOrEqual(10)
    // A major one may hit hard.
    expect(review(list({ developments: [{ ...shock, impacts: [down('approval', 'large'), down('stability', 'clear')] }] }), { beat: beat('trouble', 'major') }).ok).toBe(true)
  })

  it('a heavy reaction is dropped unless the player provoked that country', () => {
    const cutoff = { actor: 'RUS', effectId: 'energy_cutoff' as const, target: TUR, reason: 'Moskova vanayı kıstı.' }
    const plain = fitToPlan(ChangeList.parse(list({ foreignIntents: [cutoff] })), state, {})
    expect(plain.foreignIntents).toEqual([])
    const provoked = list({
      changes: [{ effectId: 'naval_show_of_force', target: { type: 'country', id: 'RUS' }, reason: 'Karadeniz’de gövde gösterisi.' }],
      foreignIntents: [cutoff]
    })
    expect(fitToPlan(ChangeList.parse(provoked), state, {}).foreignIntents).toHaveLength(1)
  })

  it('a consequence too heavy for the month is told in a smaller size', () => {
    const seed: Seed = {
      id: 'sd-000001',
      plantedTurn: 0,
      wakeTurn: 1,
      originEventId: 'ev-000001',
      sourceEffectId: 'press_crackdown',
      hook: 'basın',
      entities: [TUR],
      tags: [],
      likelihood: 'likely',
      condition: null,
      status: 'dormant',
      firedTurn: null
    }
    const raw = list({
      seedOutcomes: [{ seedId: seed.id, actor: null, effectId: 'protest_wave', target: TUR, reason: 'Ocak’taki basın yasası kampüslerde karşılığını buldu.', title: 'Kampüslerde sansür öfkesi' }]
    })
    const fitted = fitToPlan(ChangeList.parse(raw), state, { firingSeeds: [seed], seedScale: 'minor' })
    expect(fitted.seedOutcomes[0]).toMatchObject({ effectId: null, title: 'Kampüslerde sansür öfkesi' })
    expect(fitted.seedOutcomes[0]!.impacts.length).toBeGreaterThan(0)
    expect(review(fitted, { firingSeeds: [seed], seedScale: 'minor' }).ok).toBe(true)
  })
})

describe('applyTurn: a development becomes history and an effect with its own name', () => {
  it('improvised impacts get their numbers from the code’s table and the development’s name', () => {
    const verdict = reviewChangeList(list({ developments: [drought] }), state, { beat: beat('trouble') })
    if (!verdict.ok) throw new Error(JSON.stringify(verdict.issues))
    const { newState, events, report } = applyTurn(state, { order: '', changes: verdict.changes, plan: { firing: [], fizzled: [], beat: beat('trouble') } })

    const event = events.find((e) => e.kind === 'development')!
    expect(event).toMatchObject({ title: drought.title, summary: drought.story, effectId: 'improvised' })
    expect(event.tags).toEqual(expect.arrayContaining(['gelisme', 'ton-kriz']))
    const effect = newState.effects.find((e) => e.effectId === 'improvised')!
    expect(effect).toMatchObject({ label: drought.title, source: 'world', expiresTurn: 4 })
    expect(effect.modifiers).toEqual([
      { country: 'TUR', bar: 'welfare', delta: -1, mode: 'per_turn' },
      { country: 'TUR', bar: 'approval', delta: -2, mode: 'once' }
    ])
    // The report names the cause by the development's own title.
    const approval = report.bars.find((b) => b.bar === 'approval')!
    expect(approval.causes.map((c) => c.label)).toContain(drought.title)
  })

  it('a development with a catalog move is done by its actor, under the development’s name', () => {
    const offer: Development = {
      title: 'Alman yan sanayisi Bursa’ya geliyor',
      story: 'İki büyük Alman tedarikçi, Çin’deki hatlarını Bursa’ya taşımak için yer baktı.',
      actor: 'DEU',
      target: TUR,
      moves: ['foreign_investment'],
      impacts: [],
      lasts: 'month'
    }
    const verdict = reviewChangeList(list({ developments: [offer] }), state, { beat: beat('opportunity') })
    if (!verdict.ok) throw new Error(JSON.stringify(verdict.issues))
    const { newState } = applyTurn(state, { order: '', changes: verdict.changes, plan: { firing: [], fizzled: [], beat: beat('opportunity') } })
    expect(newState.effects.find((e) => e.effectId === 'foreign_investment')).toMatchObject({ actor: 'DEU', source: 'foreign', label: offer.title })
  })
})
