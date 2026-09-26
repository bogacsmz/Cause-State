import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// SQLite layout of one save file. After editing: `npm run db:generate`.
//
// Each record keeps its full JSON in `body` (the source of truth, re-validated with zod on
// load) plus the few columns we filter and sort on. Entities and tags get their own link
// tables so "everything about Greece" or "all dormant seeds tagged ab" are index lookups.

/** Hard-state snapshot per turn: the world as it was at the end of that turn. */
export const snapshots = sqliteTable('snapshots', {
  turn: integer('turn').primaryKey(),
  date: text('date').notNull(),
  body: text('body').notNull(),
  savedAt: integer('saved_at').notNull()
})

/** The event log. Append-only: history is never rewritten. */
export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    turn: integer('turn').notNull(),
    kind: text('kind').notNull(),
    visibility: text('visibility').notNull(),
    causeId: text('cause_id'),
    body: text('body').notNull()
  },
  (t) => [
    index('events_turn_idx').on(t.turn),
    index('events_kind_idx').on(t.kind),
    index('events_cause_idx').on(t.causeId)
  ]
)

export const eventEntities = sqliteTable(
  'event_entities',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull()
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.entityType, t.entityId] }),
    index('event_entities_entity_idx').on(t.entityType, t.entityId)
  ]
)

export const eventTags = sqliteTable(
  'event_tags',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull()
  },
  (t) => [primaryKey({ columns: [t.eventId, t.tag] }), index('event_tags_tag_idx').on(t.tag)]
)

/** Butterfly-effect seeds. Status changes (dormant → fired/defused), rows are never deleted. */
export const seeds = sqliteTable(
  'seeds',
  {
    id: text('id').primaryKey(),
    plantedTurn: integer('planted_turn').notNull(),
    wakeTurn: integer('wake_turn').notNull(),
    status: text('status').notNull(),
    firedTurn: integer('fired_turn'),
    originEventId: text('origin_event_id').notNull(),
    body: text('body').notNull()
  },
  (t) => [index('seeds_status_wake_idx').on(t.status, t.wakeTurn), index('seeds_origin_idx').on(t.originEventId)]
)

export const seedEntities = sqliteTable(
  'seed_entities',
  {
    seedId: text('seed_id')
      .notNull()
      .references(() => seeds.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull()
  },
  (t) => [
    primaryKey({ columns: [t.seedId, t.entityType, t.entityId] }),
    index('seed_entities_entity_idx').on(t.entityType, t.entityId)
  ]
)

export const seedTags = sqliteTable(
  'seed_tags',
  {
    seedId: text('seed_id')
      .notNull()
      .references(() => seeds.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull()
  },
  (t) => [primaryKey({ columns: [t.seedId, t.tag] }), index('seed_tags_tag_idx').on(t.tag)]
)
