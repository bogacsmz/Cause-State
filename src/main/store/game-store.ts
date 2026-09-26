import type { DatabaseSync } from 'node:sqlite'
import { and, asc, count, desc, eq, gte, inArray, lte, or, type SQL } from 'drizzle-orm'
import type { TurnOutcome } from '@shared/game/contract'
import type { EntityRef } from '@shared/game/primitives'
import { GameEvent, GameState, Seed } from '@shared/game/schema'
import { openDatabase, type Db } from './database'
import { eventEntities, events, eventTags, seedEntities, seeds, seedTags, snapshots } from './tables'

type Batchable = Parameters<Db['batch']>[0][number]

/**
 * One save file. The long-term memory of a game: state snapshots, the append-only
 * event log and the butterfly seeds, all queryable by entity, tag, turn and status.
 */
export class GameStore {
  private constructor(
    private readonly raw: DatabaseSync,
    private readonly db: Db
  ) {}

  static open(file: string): GameStore {
    const { raw, db } = openDatabase(file)
    return new GameStore(raw, db)
  }

  close(): void {
    this.raw.close()
  }

  // ── writes ────────────────────────────────────────────────────────────────

  async saveSnapshot(state: GameState): Promise<void> {
    await this.write([this.snapshotInsert(state)])
  }

  async appendEvents(list: readonly GameEvent[]): Promise<void> {
    await this.write(this.eventInserts(list))
  }

  async addSeeds(list: readonly Seed[]): Promise<void> {
    await this.write(this.seedInserts(list))
  }

  /** Saves a whole turn in one transaction: the new snapshot, its events, new seeds and seed status changes. */
  async commitTurn(outcome: Pick<TurnOutcome, 'newState' | 'events' | 'seeds'> & Partial<Pick<TurnOutcome, 'seedUpdates'>>): Promise<void> {
    await this.write([
      this.snapshotInsert(outcome.newState),
      ...this.eventInserts(outcome.events),
      ...this.seedInserts(outcome.seeds),
      ...(outcome.seedUpdates ?? []).map((seed) => this.seedUpdate(seed))
    ])
  }

  /** Moves a seed out of dormancy. The row stays: fired and defused seeds are history too. */
  async setSeedStatus(id: string, status: 'fired' | 'defused', turn: number): Promise<void> {
    const row = await this.db.select({ body: seeds.body }).from(seeds).where(eq(seeds.id, id)).get()
    if (!row) throw new Error(`seed ${id} not found`)
    const seed = Seed.parse({ ...JSON.parse(row.body), status, firedTurn: status === 'fired' ? turn : null })
    await this.write([this.seedUpdate(seed)])
  }

  // ── reads ─────────────────────────────────────────────────────────────────

  async loadLatestSnapshot(): Promise<GameState | null> {
    const row = await this.db.select({ body: snapshots.body }).from(snapshots).orderBy(desc(snapshots.turn)).limit(1).get()
    return row ? GameState.parse(JSON.parse(row.body)) : null
  }

  async loadSnapshot(turn: number): Promise<GameState | null> {
    const row = await this.db.select({ body: snapshots.body }).from(snapshots).where(eq(snapshots.turn, turn)).get()
    return row ? GameState.parse(JSON.parse(row.body)) : null
  }

  /** Public events from `fromTurn` on, oldest first: the news feed. */
  async feedSince(fromTurn: number): Promise<GameEvent[]> {
    const rows = await this.db
      .select({ body: events.body })
      .from(events)
      .where(and(eq(events.visibility, 'public'), gte(events.turn, fromTurn)))
      .orderBy(asc(events.turn), asc(events.id))
      .all()
    return rows.map((r) => GameEvent.parse(JSON.parse(r.body)))
  }

  async seedsByIds(ids: readonly string[]): Promise<Seed[]> {
    if (ids.length === 0) return []
    const rows = await this.db.select({ body: seeds.body }).from(seeds).where(inArray(seeds.id, [...ids])).all()
    return rows.map((r) => Seed.parse(JSON.parse(r.body)))
  }

  /** Newest first. Hidden events (e.g. planted seeds) are left out unless asked for. */
  async recentEvents(opts: { limit?: number; includeHidden?: boolean } = {}): Promise<GameEvent[]> {
    const rows = await this.db
      .select({ body: events.body })
      .from(events)
      .where(opts.includeHidden ? undefined : eq(events.visibility, 'public'))
      .orderBy(desc(events.turn), desc(events.id))
      .limit(opts.limit ?? 20)
      .all()
    return rows.map((r) => GameEvent.parse(JSON.parse(r.body)))
  }

  /** Everything that ever happened involving an entity, newest first. */
  async eventsForEntity(ref: EntityRef, opts: { limit?: number; includeHidden?: boolean } = {}): Promise<GameEvent[]> {
    const conditions: SQL[] = [eq(eventEntities.entityType, ref.type), eq(eventEntities.entityId, ref.id)]
    if (!opts.includeHidden) conditions.push(eq(events.visibility, 'public'))
    const rows = await this.db
      .select({ body: events.body })
      .from(eventEntities)
      .innerJoin(events, eq(events.id, eventEntities.eventId))
      .where(and(...conditions))
      .orderBy(desc(events.turn), desc(events.id))
      .limit(opts.limit ?? 50)
      .all()
    return rows.map((r) => GameEvent.parse(JSON.parse(r.body)))
  }

  async eventsByTag(tag: string, opts: { limit?: number } = {}): Promise<GameEvent[]> {
    const rows = await this.db
      .select({ body: events.body })
      .from(eventTags)
      .innerJoin(events, eq(events.id, eventTags.eventId))
      .where(eq(eventTags.tag, tag))
      .orderBy(desc(events.turn), desc(events.id))
      .limit(opts.limit ?? 50)
      .all()
    return rows.map((r) => GameEvent.parse(JSON.parse(r.body)))
  }

  /** Seeds touching any of the given entities (dormant ones by default), soonest to wake first. */
  async seedsForEntities(
    refs: readonly EntityRef[],
    opts: { status?: Seed['status']; limit?: number } = {}
  ): Promise<Seed[]> {
    if (refs.length === 0) return []
    const match = or(
      ...refs.map((r) => and(eq(seedEntities.entityType, r.type), eq(seedEntities.entityId, r.id)))
    )
    const rows = await this.db
      .selectDistinct({ body: seeds.body, wakeTurn: seeds.wakeTurn, id: seeds.id })
      .from(seedEntities)
      .innerJoin(seeds, eq(seeds.id, seedEntities.seedId))
      .where(and(match, eq(seeds.status, opts.status ?? 'dormant')))
      .orderBy(seeds.wakeTurn, seeds.id)
      .limit(opts.limit ?? 50)
      .all()
    return rows.map((r) => Seed.parse(JSON.parse(r.body)))
  }

  /** Dormant seeds whose sleep is over by `turn`: candidates to come back. */
  async dueSeeds(turn: number, opts: { limit?: number } = {}): Promise<Seed[]> {
    const rows = await this.db
      .select({ body: seeds.body })
      .from(seeds)
      .where(and(eq(seeds.status, 'dormant'), lte(seeds.wakeTurn, turn)))
      .orderBy(seeds.wakeTurn, seeds.id)
      .limit(opts.limit ?? 50)
      .all()
    return rows.map((r) => Seed.parse(JSON.parse(r.body)))
  }

  async seedsByTag(tag: string, opts: { status?: Seed['status'] } = {}): Promise<Seed[]> {
    const rows = await this.db
      .select({ body: seeds.body })
      .from(seedTags)
      .innerJoin(seeds, eq(seeds.id, seedTags.seedId))
      .where(and(eq(seedTags.tag, tag), eq(seeds.status, opts.status ?? 'dormant')))
      .orderBy(seeds.wakeTurn, seeds.id)
      .all()
    return rows.map((r) => Seed.parse(JSON.parse(r.body)))
  }

  /** The events a given event caused, for walking the cause-and-effect tree. */
  async eventsCausedBy(eventId: string): Promise<GameEvent[]> {
    const rows = await this.db.select({ body: events.body }).from(events).where(eq(events.causeId, eventId)).orderBy(events.id).all()
    return rows.map((r) => GameEvent.parse(JSON.parse(r.body)))
  }

  async stats(): Promise<{ snapshots: number; events: number; seeds: number; dormantSeeds: number }> {
    const [snapshotRows, eventRows, seedRows, dormantRows] = await Promise.all([
      this.db.select({ n: count() }).from(snapshots).get(),
      this.db.select({ n: count() }).from(events).get(),
      this.db.select({ n: count() }).from(seeds).get(),
      this.db.select({ n: count() }).from(seeds).where(eq(seeds.status, 'dormant')).get()
    ])
    return {
      snapshots: snapshotRows?.n ?? 0,
      events: eventRows?.n ?? 0,
      seeds: seedRows?.n ?? 0,
      dormantSeeds: dormantRows?.n ?? 0
    }
  }

  // ── query builders ────────────────────────────────────────────────────────

  private snapshotInsert(state: GameState): Batchable {
    const valid = GameState.parse(state)
    const body = JSON.stringify(valid)
    return this.db
      .insert(snapshots)
      .values({ turn: valid.turn, date: valid.date, body, savedAt: Date.now() })
      .onConflictDoUpdate({ target: snapshots.turn, set: { date: valid.date, body, savedAt: Date.now() } })
  }

  private eventInserts(list: readonly GameEvent[]): Batchable[] {
    if (list.length === 0) return []
    const valid = list.map((e) => GameEvent.parse(e))
    const links = valid.flatMap((e) => e.entities.map((r) => ({ eventId: e.id, entityType: r.type, entityId: r.id })))
    const tags = valid.flatMap((e) => e.tags.map((tag) => ({ eventId: e.id, tag })))
    return compact([
      this.db.insert(events).values(
        valid.map((e) => ({
          id: e.id,
          turn: e.turn,
          kind: e.kind,
          visibility: e.visibility,
          causeId: e.causeId,
          body: JSON.stringify(e)
        }))
      ),
      links.length > 0 ? this.db.insert(eventEntities).values(links) : null,
      tags.length > 0 ? this.db.insert(eventTags).values(tags) : null
    ])
  }

  private seedInserts(list: readonly Seed[]): Batchable[] {
    if (list.length === 0) return []
    const valid = list.map((s) => Seed.parse(s))
    const links = valid.flatMap((s) => s.entities.map((r) => ({ seedId: s.id, entityType: r.type, entityId: r.id })))
    const tags = valid.flatMap((s) => s.tags.map((tag) => ({ seedId: s.id, tag })))
    return compact([
      this.db.insert(seeds).values(
        valid.map((s) => ({
          id: s.id,
          plantedTurn: s.plantedTurn,
          wakeTurn: s.wakeTurn,
          status: s.status,
          firedTurn: s.firedTurn,
          originEventId: s.originEventId,
          body: JSON.stringify(s)
        }))
      ),
      links.length > 0 ? this.db.insert(seedEntities).values(links) : null,
      tags.length > 0 ? this.db.insert(seedTags).values(tags) : null
    ])
  }

  private seedUpdate(seed: Seed): Batchable {
    const valid = Seed.parse(seed)
    return this.db
      .update(seeds)
      .set({ status: valid.status, firedTurn: valid.firedTurn, body: JSON.stringify(valid) })
      .where(eq(seeds.id, valid.id))
  }

  private async write(queries: readonly Batchable[]): Promise<void> {
    if (queries.length === 0) return
    await this.db.batch(queries as [Batchable, ...Batchable[]])
  }
}

function compact<T>(items: ReadonlyArray<T | null>): T[] {
  return items.filter((i): i is T => i !== null)
}
