import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AiResult } from '../../src/shared/ipc'
import { ChangeList } from '../../src/shared/game/contract'
import type { GameState, Seed } from '../../src/shared/game/schema'
import { planMonth } from '../../src/engine/director'
import { createNewGame } from '../../src/engine/new-game'
import { reviewChangeList } from '../../src/engine/referee'
import { ReplayProvider } from '../../src/main/ai/recording'
import { LlmError, type LlmProvider, type LlmRequest } from '../../src/main/ai/types'
import { ClaudeBrain, type BrainCall } from '../../src/main/game/claude/brain'
import { ORDER_REPLY_SCHEMA, WORLD_REPLY_SCHEMA } from '../../src/main/game/claude/schemas'
import { parseNarration, partialStringField } from '../../src/main/game/claude/text'
import { GameSession } from '../../src/main/game/session'

// The Claude path, end to end, with answers Claude really gave (recorded by
// `npm run record:claude`). No network, no subscription, no API key needed.

const fixture = (name: string): ReplayProvider => ReplayProvider.fromFile(join(__dirname, '../fixtures/claude', `${name}.jsonl`))
const state = createNewGame({ gameId: 'kayit', seed: 5 })

describe('Claude reads a typed order', () => {
  it('turns a creative order into several catalog moves the referee accepts', async () => {
    const provider = fixture('creative')
    const replies: string[] = []
    const result = await new ClaudeBrain(provider).interpret(
      { state, message: 'Suriye sınırına asker yığ ve Rusya lideriyle gizli görüşme ayarla.', pending: [], recentEvents: [] },
      { onReply: (text) => replies.push(text) }
    )

    expect(result.kind).toBe('action')
    expect(result.decisions.map((d) => `${d.effectId}→${d.target.id}`)).toEqual(['border_deployment→SYR', 'backchannel_talks→RUS'])
    expect(result.rejected).toEqual([])
    // The reply streamed in word by word before the answer was complete.
    expect(replies.length).toBeGreaterThan(5)
    expect(replies.at(-1)).toBe(result.reply)
    expect(result.reply).toMatch(/Efendim/)
    // Claude asked for a JSON document shaped by the schema, at low effort.
    expect(provider.requests[0]).toMatchObject({ schema: ORDER_REPLY_SCHEMA, effort: 'low' })
  })

  it('an absurd order: the referee rejects the attempt, Claude tells what it cost', async () => {
    const rejected: string[][] = []
    const result = await new ClaudeBrain(fixture('absurd')).interpret(
      { state, message: 'Dünyayı fethet.', pending: [], recentEvents: [] },
      { onRejected: (r) => rejected.push(r.reasons) }
    )

    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0]!.decisions.map((d) => d.effectId)).toContain('cross_border_operation')
    expect(rejected[0]!.join(' ')).toContain('askerî üstünlüğümüz yok')
    expect(result.decisions.map((d) => d.effectId)).toEqual(['reckless_gambit'])
  })

  it('a question is free: no decisions, the moves it discusses come with real numbers', async () => {
    const before = structuredClone(state)
    const result = await new ClaudeBrain(fixture('talk')).interpret({
      state,
      message: 'Durum nedir? Vergileri indirsem ne olur?',
      pending: [],
      recentEvents: []
    })
    expect(result).toMatchObject({ kind: 'talk', decisions: [] })
    expect(result.discussed).toContain('tax_cut')
    expect(state).toEqual(before)
  })
})

describe('Claude plays the world for a month', () => {
  it('proposes the world moves, the referee approves, an earlier decision comes back as news, the news is Claude’s', async () => {
    const turnState = { ...createNewGame({ gameId: 'kayit-tur-2', seed: 9 }), turn: 3, date: '2026-04-01' }
    const seed: Seed = {
      id: 'sd-000001',
      plantedTurn: 1,
      wakeTurn: 4,
      originEventId: 'ev-000001',
      sourceEffectId: 'press_crackdown',
      hook: 'basına baskı',
      entities: [{ type: 'country', id: 'TUR' }],
      tags: ['basin'],
      likelihood: 'likely',
      condition: null,
      status: 'dormant',
      firedTurn: null
    }
    const provider = fixture('turn')
    const calls: BrainCall[] = []
    let news = ''
    const phases: string[] = []
    const { resolution, fallback } = await new ClaudeBrain(provider).resolve(
      {
        state: turnState,
        decisions: [
          { effectId: 'border_deployment', target: { type: 'country', id: 'SYR' }, reason: 'Sınıra yığınak.' },
          { effectId: 'backchannel_talks', target: { type: 'country', id: 'RUS' }, reason: 'Gizli kanal.' }
        ],
        orders: ['Suriye sınırına asker yığ ve Rusya lideriyle gizli görüşme ayarla.'],
        dueSeeds: [seed],
        relevantSeeds: [],
        recentEvents: []
      },
      { onCall: (c) => calls.push(c), onNarration: (d) => (news += d), onPhase: (p) => phases.push(p) }
    )

    expect(fallback).toBeUndefined()
    expect(resolution.attempts).toBe(1)
    // The approved list really passes the referee on its own, in the month the director planned.
    const plan = resolution.plan
    expect(reviewChangeList(ChangeList.parse(resolution.changes), turnState, { firingSeeds: [seed], beat: plan.beat ?? null, seedScale: plan.seedScale }).ok).toBe(true)
    expect(provider.requests[0]).toMatchObject({ schema: WORLD_REPLY_SCHEMA, effort: 'medium' })
    // Claude was told how the month is paced: who may react, whether the world brings something, how big a consequence may be.
    expect(provider.requests[0]!.prompt).toContain('"reactors":["SYR","RUS"]')
    expect(provider.requests[0]!.prompt).toContain('"consequenceScale":"major"')

    const { outcome } = resolution
    expect(outcome.report.firedSeeds).toEqual([expect.objectContaining({ seedId: seed.id, source: 'press_crackdown', origin: 'Basına baskı' })])
    // It comes back as news of its own, without a label; the story says where it came from.
    const back = outcome.events.find((e) => e.kind === 'seed_fired')!
    expect(back.title).not.toMatch(/kelebek|tohum/i)
    expect(back.summary).toMatch(/Şubat|basın|gazete/i)
    expect(back.tags).toContain('gelisme')
    expect(outcome.seeds.every((s) => s.plantedTurn === 4)).toBe(true)

    // The newsroom wrote after the code applied the month, and its text replaced the placeholder.
    const narration = outcome.events.find((e) => e.kind === 'narration')!
    expect(narration.title).toBe(outcome.narration.headline)
    expect(news.startsWith(outcome.narration.headline)).toBe(true)
    expect(outcome.narration.body).not.toMatch(/kelebek/i)
    expect(phases).toEqual(['world', 'referee', 'news'])
    expect(calls.map((c) => c.role)).toEqual(['resolve', 'narrate'])
  })
})

describe('the world brings something of its own', () => {
  it('in a quiet month the director planned an opening, Claude writes it and the code applies it', async () => {
    const quiet = createNewGame({ gameId: 'kayit-gelisme', seed: 12 })
    const turn = firstOpportunityTurn(quiet)
    const provider = fixture('development')
    const { resolution, fallback } = await new ClaudeBrain(provider).resolve({
      state: { ...quiet, turn },
      decisions: [],
      orders: [],
      dueSeeds: [],
      relevantSeeds: [],
      recentEvents: []
    })
    expect(fallback).toBeUndefined()
    expect(resolution.plan.beat).toMatchObject({ tone: 'opportunity' })
    expect(provider.requests[0]!.prompt).toContain('"development":{"tone":"opportunity"')
    const event = resolution.outcome.events.find((e) => e.kind === 'development')!
    expect(event.title.length).toBeGreaterThan(10)
    expect(event.summary.length).toBeGreaterThan(40)
    expect(event.tags).toEqual(expect.arrayContaining(['gelisme', 'ton-firsat']))
    // Nobody reacts to a month without decisions.
    expect(resolution.outcome.events.some((e) => e.kind === 'foreign_action')).toBe(false)
  })
})

/** Same search as scripts/record-claude-fixtures.mts. */
function firstOpportunityTurn(state: GameState): number {
  for (let turn = 0; turn < 50; turn++) if (planMonth({ ...state, turn }, [], []).beat?.tone === 'opportunity') return turn
  throw new Error('no opportunity month found')
}

describe('the whole session with Claude (recorded)', () => {
  const open: GameSession[] = []
  afterEach(() => {
    while (open.length) open.pop()?.close()
  })

  it('orders cost capital, talk is free, the turn is played and every call is logged', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cs-claude-session-'))
    const session = await GameSession.open(dir, { brain: new ClaudeBrain(fixture('session')), first: { gameId: 'kayit-oturum', seed: 3 } })
    open.push(session)

    const order = await session.command('Suriye sınırına asker yığ ve Rusya lideriyle gizli görüşme ayarla.')
    expect(order.view.pending.map((p) => p.effectId)).toEqual(['border_deployment', 'backchannel_talks'])
    expect(order.view.player.capital.left).toBe(1)

    const talk = await session.command('Şu an seçimi kazanır mıyız?')
    expect(talk.ok).toBe(false)
    expect(talk.view.player.capital.left).toBe(1)
    expect(talk.view.chat.map((c) => c.kind)).toEqual(['action', 'talk'])
    expect(talk.view.chat[0]!.decisions).toEqual(['Sınıra yığınak · Suriye', 'Gizli görüşme · Rusya'])

    const view = await session.endTurn()
    expect(view.turn).toBe(1)
    expect(view.ai).toEqual({ kind: 'claude', notice: null })
    const news = view.feed.filter((e) => e.kind === 'narration').at(-1)!
    expect(`${news.title} ${news.summary}`).toMatch(/Suriye|sınır/i)
    // The events carry Claude's reading of the order, not a generic label.
    expect(view.feed.find((e) => e.kind === 'effect_applied')!.summary.length).toBeGreaterThan(30)

    const log = readFileSync(join(dir, 'oyun-kayit-oturum.log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as BrainCall)
    expect(log.map((c) => c.role)).toEqual(['interpret', 'interpret', 'resolve', 'narrate'])
    expect(log[0]!.prompt).toContain('"message"')
  })
})

describe('when Claude is not there', () => {
  class Failing implements LlmProvider {
    readonly id = 'cli' as const
    async status() {
      return { provider: 'cli' as const, ready: false, label: 'yok', detail: 'yok' }
    }
    async generate(): Promise<AiResult> {
      throw new LlmError('claude komutu bulunamadı.')
    }
  }

  it('the scripted rules answer instead, and say so', async () => {
    const result = await new ClaudeBrain(new Failing()).interpret({ state, message: 'Vergileri indir', pending: [], recentEvents: [] })
    expect(result.fallback).toContain('claude komutu bulunamadı')
    expect(result.decisions.map((d) => d.effectId)).toEqual(['tax_cut'])
  })

  it('the month is still played by the scripted rules', async () => {
    const { resolution, fallback } = await new ClaudeBrain(new Failing()).resolve({
      state,
      decisions: [{ effectId: 'tax_cut', target: { type: 'country', id: 'TUR' }, reason: 'x' }],
      orders: [],
      dueSeeds: [],
      relevantSeeds: [],
      recentEvents: []
    })
    expect(fallback).toContain('kurallı yedek')
    expect(resolution.outcome.newState.turn).toBe(1)
  })
})

describe('repair on a malformed answer', () => {
  class Scripted implements LlmProvider {
    readonly id = 'cli' as const
    readonly prompts: string[] = []
    constructor(private readonly answers: string[]) {}
    async status() {
      return { provider: 'cli' as const, ready: true, label: '', detail: '' }
    }
    async generate(req: LlmRequest): Promise<AiResult> {
      this.prompts.push(req.prompt)
      return { text: this.answers.shift() ?? '', durationMs: 1 }
    }
  }

  it('sends the problem back and uses the corrected answer', async () => {
    const provider = new Scripted([
      '{"kind":"action","reply":"Tamam"}',
      JSON.stringify({ kind: 'action', reply: 'Emredersiniz.', decisions: [{ effectId: 'tax_cut', target: { type: 'country', id: 'TUR' }, reason: 'Vergi indirimi.' }], discussed: [] })
    ])
    const result = await new ClaudeBrain(provider).interpret({ state, message: 'Vergileri indir', pending: [], recentEvents: [] })
    expect(result.decisions.map((d) => d.effectId)).toEqual(['tax_cut'])
    expect(provider.prompts[1]).toContain('did not match the required JSON shape')
  })

  it('an order beyond the month’s capital goes back to Claude with the referee’s reasons', async () => {
    const tur = { type: 'country', id: 'TUR' } as const
    const provider = new Scripted([
      JSON.stringify({
        kind: 'action',
        reply: 'Hepsi olacak.',
        decisions: ['tax_cut', 'mega_project', 'national_rally', 'social_housing'].map((effectId) => ({ effectId, target: tur, reason: 'x' })),
        discussed: []
      }),
      JSON.stringify({ kind: 'action', reply: 'Önce üçü.', decisions: ['tax_cut', 'mega_project', 'national_rally'].map((effectId) => ({ effectId, target: tur, reason: 'x' })), discussed: [] })
    ])
    const result = await new ClaudeBrain(provider).interpret({ state, message: 'Halkı sevindir', pending: [], recentEvents: [] })
    expect(result.rejected[0]!.reasons.join(' ')).toContain('sermaye yetmiyor')
    expect(provider.prompts[1]).toContain('political capital')
    expect(result.decisions).toHaveLength(3)
  })

  it('a world move the referee rejects is repaired, and the log keeps its verdict', async () => {
    const world = (effectId: string) =>
      JSON.stringify({
        interpretation: 'Hükûmet vergileri indirdi.',
        reactions: [{ actor: 'RUS', effectId, target: { type: 'country', id: 'TUR' }, reason: 'Moskova tepki gösterdi.' }],
        development: null,
        consequences: [],
        newSeeds: []
      })
    // Tax cuts are the player's move only; a diplomatic note is what Moscow can do.
    const provider = new Scripted([world('tax_cut'), world('diplomatic_protest'), 'Vergiler indi\n\nAnkara vergileri indirdi.'])
    const log: BrainCall[] = []
    const { resolution, fallback } = await new ClaudeBrain(provider).resolve(
      {
        state,
        decisions: [{ effectId: 'tax_cut', target: { type: 'country', id: 'TUR' }, reason: 'x' }],
        orders: ['Vergileri indir'],
        dueSeeds: [],
        relevantSeeds: [],
        recentEvents: []
      },
      { onCall: (c) => log.push(c) }
    )
    expect(fallback).toBeUndefined()
    expect(provider.prompts[1]).toContain('The referee rejected your previous answer')
    expect(log.map((c) => `${c.role}${c.attempt}:${c.issues.length > 0 ? 'rejected' : 'ok'}`)).toEqual(['resolve1:rejected', 'resolve2:ok', 'narrate1:ok'])
    // The referee's objection comes back in the names Claude wrote (reactions, not foreignIntents).
    expect(log[0]!.issues.join(' ')).toContain('reactions[0]')
    expect(provider.prompts[1]).toContain('"tax_cut" cannot be done by a foreign country')
    expect(resolution.outcome.events.some((e) => e.kind === 'foreign_action')).toBe(true)
  })
})

describe('reading streamed text', () => {
  it('pulls a string field out of JSON that is still arriving', () => {
    expect(partialStringField('{"kind":"talk","rep', 'reply')).toBeNull()
    expect(partialStringField('{"kind":"talk","reply":"Efendim, du', 'reply')).toBe('Efendim, du')
    expect(partialStringField('{"reply":"a \\"b\\"\\nc\\u00e7', 'reply')).toBe('a "b"\ncç')
    expect(partialStringField('{"reply":"bitti","decisions":[]}', 'reply')).toBe('bitti')
  })

  it('splits the news into a headline and a body within the contract', () => {
    expect(parseNarration('**Ankara’da sıcak gün**\n\nBirinci paragraf.\n\n\n\nİkinci.')).toEqual({
      headline: 'Ankara’da sıcak gün',
      body: 'Birinci paragraf.\n\nİkinci.'
    })
    expect(parseNarration('   ')).toBeNull()
  })
})
