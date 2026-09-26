import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { createNewGame } from '../../src/engine/new-game'
import { reviewChangeList } from '../../src/engine/referee'
import { applyTurn } from '../../src/engine/turn'
import { GameStore } from '../../src/main/store/game-store'
import { MIGRATIONS } from '../../src/main/store/migrations.generated'
import { ORDER, VALID_CHANGES } from './fixtures'

const open: GameStore[] = []
function tempFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'cs-store-')), 'oyun.sqlite')
}
function openStore(file: string): GameStore {
  const store = GameStore.open(file)
  open.push(store)
  return store
}
afterEach(() => {
  while (open.length) open.pop()?.close()
})

function playFirstTurn() {
  const state = createNewGame({ gameId: 'kanit', seed: 99 })
  const verdict = reviewChangeList(VALID_CHANGES, state)
  if (!verdict.ok) throw new Error('fixture should be valid')
  return { state, outcome: applyTurn(state, { order: ORDER, changes: verdict.changes }) }
}

describe('GameStore (SQLite)', () => {
  it('saves a new game and loads it back identical, across a reopen', async () => {
    const file = tempFile()
    const state = createNewGame({ gameId: 'kanit', seed: 99 })

    const first = openStore(file)
    await first.saveSnapshot(state)
    first.close()
    open.pop()

    const second = openStore(file)
    expect(await second.loadLatestSnapshot()).toEqual(state)
  })

  it('stores a whole turn and answers queries by entity, tag and status', async () => {
    const store = openStore(tempFile())
    const { state, outcome } = playFirstTurn()
    await store.saveSnapshot(state)
    await store.commitTurn(outcome)

    expect(await store.loadLatestSnapshot()).toEqual(outcome.newState)
    expect(await store.loadSnapshot(0)).toEqual(state)

    const aboutGreece = await store.eventsForEntity({ type: 'country', id: 'GRC' })
    expect(aboutGreece.map((e) => e.kind)).toEqual(['effect_applied', 'order'])

    const franceSeeds = await store.seedsForEntities([{ type: 'country', id: 'FRA' }])
    expect(franceSeeds).toHaveLength(1)
    expect(franceSeeds[0]).toEqual(outcome.seeds[0])
    expect(await store.seedsByTag('veto-tehdidi')).toHaveLength(1)
    expect(await store.seedsForEntities([{ type: 'country', id: 'CHN' }])).toEqual([])

    // Hidden events are memory, not news.
    const news = await store.recentEvents()
    expect(news.some((e) => e.kind === 'seed_planted')).toBe(false)
    expect((await store.recentEvents({ includeHidden: true })).some((e) => e.kind === 'seed_planted')).toBe(true)

    const order = outcome.events[0]!
    expect((await store.eventsCausedBy(order.id)).map((e) => e.kind)).toEqual([
      'effect_applied',
      'effect_applied',
      'foreign_action',
      'seed_planted',
      'narration'
    ])
  })

  it('tracks a seed from dormant to fired without losing it', async () => {
    const store = openStore(tempFile())
    const { outcome } = playFirstTurn()
    await store.commitTurn(outcome)
    const seed = outcome.seeds[0]!

    expect(await store.dueSeeds(seed.wakeTurn - 1)).toEqual([])
    expect((await store.dueSeeds(seed.wakeTurn)).map((s) => s.id)).toEqual([seed.id])

    await store.setSeedStatus(seed.id, 'fired', seed.wakeTurn)
    expect(await store.dueSeeds(seed.wakeTurn)).toEqual([])
    const fired = await store.seedsForEntities([{ type: 'country', id: 'FRA' }], { status: 'fired' })
    expect(fired[0]).toMatchObject({ id: seed.id, status: 'fired', firedTurn: seed.wakeTurn })
  })

  it('saves a turn atomically: a failing write leaves nothing behind', async () => {
    const store = openStore(tempFile())
    const { outcome } = playFirstTurn()
    await store.commitTurn(outcome)

    // Same event ids again: the batch must fail as a whole, including the new snapshot.
    const replay = { ...outcome, newState: { ...outcome.newState, turn: 2 } }
    await expect(store.commitTurn(replay)).rejects.toThrow()
    expect((await store.loadLatestSnapshot())?.turn).toBe(1)
    expect((await store.stats()).events).toBe(outcome.events.length)
  })

  it('migrates a new file once and records the schema version', async () => {
    const file = tempFile()
    openStore(file).close()
    open.pop()
    openStore(file).close()
    open.pop()

    const raw = new DatabaseSync(file)
    const { user_version } = raw.prepare('PRAGMA user_version').get() as { user_version: number }
    const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>
    raw.close()

    expect(user_version).toBe(MIGRATIONS.length)
    expect(tables.map((t) => t.name)).toEqual([
      'event_entities',
      'event_tags',
      'events',
      'seed_entities',
      'seed_tags',
      'seeds',
      'snapshots'
    ])
  })
})
