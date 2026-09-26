import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import { MIGRATIONS } from './migrations.generated'
import * as tables from './tables'

// Node's built-in SQLite (no native module to rebuild for Electron) behind Drizzle's
// proxy driver. Drizzle builds typed queries; this file only runs them.

export type Db = SqliteRemoteDatabase<typeof tables>
type Method = 'run' | 'all' | 'values' | 'get'

export interface OpenedDatabase {
  raw: DatabaseSync
  db: Db
}

/** Opens (or creates) a save file and brings its schema up to date. ':memory:' works for tests. */
export function openDatabase(file: string): OpenedDatabase {
  const raw = new DatabaseSync(file)
  raw.exec('PRAGMA foreign_keys = ON')
  migrate(raw)

  const run = (sql: string, params: unknown[], method: Method): { rows: unknown } => {
    const stmt = raw.prepare(sql)
    const args = params as SQLInputValue[]
    if (method === 'run') {
      stmt.run(...args)
      return { rows: [] }
    }
    // Drizzle's proxy driver maps rows by column position, not by name.
    stmt.setReturnArrays(true)
    return { rows: method === 'get' ? stmt.get(...args) : stmt.all(...args) }
  }

  const db = drizzle(
    async (sql, params, method) => run(sql, params, method) as { rows: never[] },
    // A batch is one transaction: a turn is saved completely or not at all.
    async (queries) => {
      raw.exec('BEGIN')
      try {
        const results = queries.map((q) => run(q.sql, q.params, q.method))
        raw.exec('COMMIT')
        return results as Array<{ rows: never[] }>
      } catch (err) {
        raw.exec('ROLLBACK')
        throw err
      }
    },
    { schema: tables }
  )

  return { raw, db }
}

/** Applies embedded migrations newer than the file's PRAGMA user_version. */
export function migrate(raw: DatabaseSync): void {
  const { user_version: version } = raw.prepare('PRAGMA user_version').get() as { user_version: number }
  if (version > MIGRATIONS.length) {
    throw new Error(`Bu kayıt dosyası oyunun daha yeni bir sürümüyle oluşturulmuş (şema ${version}).`)
  }
  for (let i = version; i < MIGRATIONS.length; i++) {
    raw.exec('BEGIN')
    try {
      for (const statement of MIGRATIONS[i]!.sql.split('--> statement-breakpoint')) {
        if (statement.trim()) raw.exec(statement)
      }
      raw.exec(`PRAGMA user_version = ${i + 1}`)
      raw.exec('COMMIT')
    } catch (err) {
      raw.exec('ROLLBACK')
      throw err
    }
  }
}
