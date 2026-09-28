import { describe, expect, it } from 'vitest'
import { happeningsFrom, PACING, planMonth, type Happening } from '../../src/engine/director'
import { createNewGame } from '../../src/engine/new-game'
import type { Tone } from '../../src/shared/game/impacts'
import type { GameEvent, GameState, Seed } from '../../src/shared/game/schema'

// The month's pacing, as numbers: calm months are the norm, news is mixed, trouble rarely
// follows trouble, big stories are rare and spaced, and the same game replays the same way.

interface Run {
  months: number
  developments: Array<{ turn: number; tone: Tone; major: boolean }>
}

function run(games: number, turns: number, tweak: (s: GameState) => GameState = (s) => s): Run[] {
  return Array.from({ length: games }, (_, g) => {
    const base = tweak(createNewGame({ gameId: `yonetmen-${g}`, seed: g }))
    let past: Happening[] = []
    const developments: Run['developments'] = []
    for (let t = 0; t < turns; t++) {
      const plan = planMonth({ ...base, turn: t }, [], past)
      if (!plan.beat) continue
      const h = { turn: t + 1, tone: plan.beat.tone, major: plan.beat.scale === 'major' }
      developments.push(h)
      past = [h, ...past]
    }
    return { months: turns, developments }
  })
}

const all = run(400, 20)
const flat = all.flatMap((r) => r.developments)
const share = (tone: Tone): number => flat.filter((d) => d.tone === tone).length / flat.length

describe('the director (how busy a month is, and in which tone)', () => {
  it('most months are calm: something in about a third of them, never every month', () => {
    const perGame = all.map((r) => r.developments.length)
    const average = perGame.reduce((a, b) => a + b, 0) / perGame.length
    expect(average).toBeGreaterThan(4)
    expect(average).toBeLessThan(8)
    expect(Math.max(...perGame)).toBeLessThan(13)
  })

  it('news is mixed: openings and good luck outweigh trouble', () => {
    expect(share('opportunity') + share('good')).toBeGreaterThan(0.4)
    expect(share('trouble')).toBeLessThan(0.36)
    expect(share('neutral')).toBeGreaterThan(0.12)
  })

  it('trouble rarely follows trouble', () => {
    let pairs = 0
    let troubles = 0
    for (const r of all) {
      r.developments.forEach((d, i) => {
        if (d.tone !== 'trouble') return
        troubles++
        if (r.developments[i - 1]?.tone === 'trouble') pairs++
      })
    }
    expect(pairs / troubles).toBeLessThan(0.2)
  })

  it('big stories are rare and at least eight months apart', () => {
    const majors = flat.filter((d) => d.major)
    expect(majors.length / flat.length).toBeLessThan(0.2)
    expect(majors.length).toBeGreaterThan(0)
    for (const r of all) {
      const turns = r.developments.filter((d) => d.major).map((d) => d.turn)
      for (let i = 1; i < turns.length; i++) expect(turns[i]! - turns[i - 1]!).toBeGreaterThanOrEqual(PACING.majorGap)
    }
  })

  it('a struggling government meets more openings, a comfortable one more trouble', () => {
    const tones = (runs: Run[]): Record<Tone, number> => {
      const list = runs.flatMap((r) => r.developments)
      const count = (t: Tone): number => list.filter((d) => d.tone === t).length / list.length
      return { opportunity: count('opportunity'), good: count('good'), neutral: count('neutral'), trouble: count('trouble') }
    }
    const setApproval = (value: number) => (s: GameState) => ({
      ...s,
      countries: s.countries.map((c) => (c.id === s.playerCountryId ? { ...c, bars: { ...c.bars, approval: value } } : c))
    })
    const struggling = tones(run(300, 20, setApproval(35)))
    const comfortable = tones(run(300, 20, setApproval(65)))
    expect(struggling.opportunity).toBeGreaterThan(comfortable.opportunity)
    expect(struggling.trouble).toBeLessThan(comfortable.trouble)
  })

  it('a consequence coming back mostly fills the month on its own', () => {
    const state = createNewGame({ gameId: 'dolu-ay', seed: 3 })
    const seed = (id: string, wakeTurn: number): Seed => ({
      id,
      plantedTurn: 0,
      wakeTurn,
      originEventId: 'ev-000001',
      sourceEffectId: 'tax_cut',
      hook: 'vergi',
      entities: [{ type: 'country', id: 'TUR' }],
      tags: [],
      likelihood: 'likely',
      condition: null,
      status: 'dormant',
      firedTurn: null
    })
    let withSeed = 0
    let beats = 0
    for (let t = 0; t < 400; t++) {
      const plan = planMonth({ ...state, turn: t }, [seed(`sd-${t}`, t + 1)], [])
      if (plan.firing.length === 0) continue
      withSeed++
      if (plan.beat) beats++
    }
    expect(withSeed).toBeGreaterThan(100)
    expect(beats / withSeed).toBeLessThan(0.25)
  })

  it('sweet-now decisions mostly come back as bills, bitter-now ones as payoffs; the code picks the tone', () => {
    const state = createNewGame({ gameId: 'ton', seed: 5 })
    const tones = (source: Seed['sourceEffectId']): Record<string, number> => {
      const count: Record<string, number> = { good: 0, neutral: 0, trouble: 0 }
      for (let t = 0; t < 400; t++) {
        const seed: Seed = {
          id: `sd-${t}`,
          plantedTurn: 0,
          wakeTurn: t + 1,
          originEventId: 'ev-000001',
          sourceEffectId: source,
          hook: 'x',
          entities: [{ type: 'country', id: 'TUR' }],
          tags: [],
          likelihood: 'likely',
          condition: null,
          status: 'dormant',
          firedTurn: null
        }
        const plan = planMonth({ ...state, turn: t }, [seed], [])
        if (plan.seedTone) count[plan.seedTone]!++
      }
      return count
    }
    const taxCut = tones('tax_cut')
    const rateHike = tones('interest_rate_hike')
    expect(taxCut.trouble!).toBeGreaterThan(taxCut.good! * 3)
    expect(rateHike.good!).toBeGreaterThan(rateHike.trouble! * 2)
  })

  it('replays the same way, and reads its history back from the event log', () => {
    const state = createNewGame({ gameId: 'tekrar', seed: 1 })
    const past: Happening[] = [{ turn: 2, tone: 'trouble', major: false }]
    expect(planMonth({ ...state, turn: 5 }, [], past)).toEqual(planMonth({ ...state, turn: 5 }, [], past))
    const event = (turn: number, tags: string[]): GameEvent => ({
      id: `ev-${turn}`,
      turn,
      date: '2026-02-01',
      kind: 'development',
      visibility: 'public',
      title: 'x',
      summary: '',
      entities: [],
      tags,
      causeId: null
    })
    expect(happeningsFrom([event(3, ['gelisme', 'ton-firsat']), event(7, ['gelisme', 'ton-kriz', 'olcek-buyuk']), event(8, ['ekonomi'])])).toEqual([
      { turn: 7, tone: 'trouble', major: true },
      { turn: 3, tone: 'opportunity', major: false }
    ])
  })
})
