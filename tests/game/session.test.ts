import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GameSession } from '../../src/main/game/session'

const open: GameSession[] = []
async function session(dir = mkdtempSync(join(tmpdir(), 'cs-session-'))): Promise<{ s: GameSession; dir: string }> {
  const s = await GameSession.open(dir)
  open.push(s)
  return { s, dir }
}
afterEach(() => {
  while (open.length) open.pop()?.close()
})

describe('GameSession (main process)', () => {
  it('starts a new game in an empty folder and shows the desk', async () => {
    const { s, dir } = await session()
    const view = await s.view()
    expect(view).toMatchObject({ turn: 0, status: 'playing', player: { id: 'TUR', capital: { current: 3, left: 3 } } })
    expect(view.options.find((o) => o.effectId === 'tax_cut')).toMatchObject({ available: true, categoryLabel: 'Ekonomi' })
    expect(readdirSync(dir).filter((f) => f.endsWith('.sqlite'))).toHaveLength(1)
  })

  it('turns a typed order into a pending decision, and a question into free advice', async () => {
    const { s } = await session()
    const order = await s.command('Vergileri indir')
    expect(order).toMatchObject({ ok: true, view: { player: { capital: { left: 2 } } } })
    expect(order.view.pending).toEqual([expect.objectContaining({ effectId: 'tax_cut', order: 'Vergileri indir' })])
    expect(order.view.options.find((o) => o.effectId === 'tax_cut')).toMatchObject({ picked: true, available: false })

    const talk = await s.command('Durum nedir?')
    expect(talk.ok).toBe(false)
    expect(talk.view.player.capital.left).toBe(2)
    expect(talk.view.chat.map((c) => c.kind)).toEqual(['decision', 'talk'])
  })

  it('refuses a card the rules do not allow, and lets a pick be taken back', async () => {
    const { s } = await session()
    const refused = await s.pick('eu_membership', { type: 'country', id: 'TUR' })
    expect(refused).toMatchObject({ ok: false, message: 'Önce "AB üyelik başvurusu" gerekli.' })
    const picked = await s.pick('trade_agreement', { type: 'country', id: 'GRC' })
    const id = picked.view.pending[0]!.id
    expect((await s.unpick(id)).pending).toEqual([])
  })

  it('plays turns into the save file and picks the game up again after a restart', async () => {
    const { s, dir } = await session()
    await s.pick('press_crackdown', { type: 'country', id: 'TUR' })
    let view = await s.endTurn()
    expect(view).toMatchObject({ turn: 1, pending: [] })
    expect(view.report?.bars.find((b) => b.bar === 'stability')?.causes).toContainEqual(
      expect.objectContaining({ label: 'Basına baskı', kind: 'effect' })
    )
    expect(view.feed.some((e) => e.kind === 'narration')).toBe(true)
    for (let i = 0; i < 3; i++) view = await s.endTurn()
    s.close()
    open.pop()

    const { s: again } = await session(dir)
    const reloaded = await again.view()
    expect(reloaded.turn).toBe(4)
    expect(reloaded.polls.map((p) => p.turn)).toEqual([0, 1, 2, 3, 4])
    expect(reloaded.player.bars).toEqual(view.player.bars)
  })

  it('queues calls: two quick clicks play two turns one after the other, never at once', async () => {
    const { s } = await session()
    const [a, b] = await Promise.all([s.endTurn(), s.endTurn()])
    expect([a.turn, b.turn]).toEqual([1, 2])
  })

  it('a new game gets its own save file', async () => {
    const { s, dir } = await session()
    await s.endTurn()
    const fresh = await s.newGame()
    expect(fresh.turn).toBe(0)
    expect(readdirSync(dir).filter((f) => f.endsWith('.sqlite'))).toHaveLength(2)
  })
})
