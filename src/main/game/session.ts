import { randomInt } from 'node:crypto'
import { mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { EffectId } from '@shared/game/catalog'
import type { EntityRef } from '@shared/game/primitives'
import type { GameState } from '@shared/game/schema'
import type { ActionResult, ChatEntry, GameView } from '@shared/game/view'
import { createNewGame } from '../../engine/new-game'
import { checkDecision, explainIssue } from '../../engine/referee'
import { resolveTurn } from '../../engine/resolve'
import { interpretOrder } from '../../engine/scripted-ai'
import { buildView, type PendingDecision } from '../../engine/view'
import { GameStore } from '../store/game-store'

/** How many past turns of news the briefing shows. */
const FEED_TURNS = 8
const SAVE_PREFIX = 'oyun-'

/**
 * The running game in the main process: one save file, the decisions picked for the
 * coming turn, and the conversation with the advisor. Calls are queued, so a double
 * click on "end turn" can never play two turns at once.
 */
export class GameSession {
  private pending: PendingDecision[] = []
  private chat: ChatEntry[] = []
  private nextId = 1
  private queue: Promise<unknown> = Promise.resolve()

  private constructor(
    private readonly dir: string,
    private store: GameStore,
    private state: GameState
  ) {}

  /**
   * Opens the most recent save in `dir`, or starts a new game if there is none.
   * `first` fixes the dice and id of that new game, for reproducible demos and tests.
   */
  static async open(dir: string, first: { seed?: number; gameId?: string } = {}): Promise<GameSession> {
    mkdirSync(dir, { recursive: true })
    const latest = latestSave(dir)
    if (latest) {
      const store = GameStore.open(latest)
      const state = await store.loadLatestSnapshot()
      if (state) return new GameSession(dir, store, state)
      store.close()
    }
    const { store, state } = await startGame(dir, first)
    return new GameSession(dir, store, state)
  }

  close(): void {
    this.store.close()
  }

  view(): Promise<GameView> {
    return this.run(() => this.buildView())
  }

  /** Leaves the current save on disk and starts a fresh one. */
  newGame(): Promise<GameView> {
    return this.run(async () => {
      const { store, state } = await startGame(this.dir)
      this.store.close()
      this.store = store
      this.state = state
      this.pending = []
      this.chat = []
      return this.buildView()
    })
  }

  /** A typed order: becomes a picked decision, or a free answer from the advisor. */
  command(text: string): Promise<ActionResult> {
    return this.run(async () => {
      const order = text.trim()
      if (this.state.status !== 'playing') return { view: await this.buildView(), ok: false, message: 'Oyun bitti.' }
      const result = interpretOrder(this.state, order, this.decisions())
      if (result.kind === 'decision') this.pending.push({ id: this.id('k'), decision: result.decision, order })
      this.chat.push({ id: this.id('c'), turn: this.state.turn, text: order, reply: result.reply, kind: result.kind })
      return { view: await this.buildView(), ok: result.kind === 'decision', message: result.reply }
    })
  }

  /** A card clicked on the desk. */
  pick(effectId: EffectId, target: EntityRef): Promise<ActionResult> {
    return this.run(async () => {
      if (this.state.status !== 'playing') return { view: await this.buildView(), ok: false, message: 'Oyun bitti.' }
      const issues = checkDecision(this.state, effectId, target, this.decisions())
      if (issues.length > 0) return { view: await this.buildView(), ok: false, message: explainIssue(issues[0]!) }
      this.pending.push({ id: this.id('k'), decision: { effectId, target }, order: null })
      return { view: await this.buildView(), ok: true }
    })
  }

  unpick(id: string): Promise<GameView> {
    return this.run(async () => {
      this.pending = this.pending.filter((p) => p.id !== id)
      return this.buildView()
    })
  }

  /** Plays the turn: scripted AI proposes, the referee approves, the engine applies, the save file records. */
  endTurn(): Promise<GameView> {
    return this.run(async () => {
      if (this.state.status !== 'playing') return this.buildView()
      const candidateSeeds = await this.store.dueSeeds(this.state.turn + 1)
      const res = await resolveTurn(this.state, {
        decisions: this.decisions(),
        orders: this.pending.flatMap((p) => (p.order ? [p.order] : [])),
        candidateSeeds
      })
      if (!res.ok) throw new Error(`Tur uygulanamadı: ${res.issues.map((i) => i.message).join('; ')}`)
      await this.store.commitTurn(res.outcome)
      this.state = res.outcome.newState
      this.pending = []
      return this.buildView()
    })
  }

  private decisions(): PendingDecision['decision'][] {
    return this.pending.map((p) => p.decision)
  }

  private async buildView(): Promise<GameView> {
    const feed = await this.store.feedSince(Math.max(0, this.state.turn - FEED_TURNS + 1))
    const seedIds = feed.flatMap((e) => (e.kind === 'seed_fired' && e.seedId ? [e.seedId] : []))
    const seeds = await this.store.seedsByIds(seedIds)
    const history = await this.store.barHistory(this.state.playerCountryId, 'approval')
    return buildView({
      state: this.state,
      feed,
      seeds,
      pending: this.pending,
      chat: this.chat.filter((c) => c.turn > this.state.turn - FEED_TURNS),
      polls: history.map((h) => ({ turn: h.turn, approval: h.value }))
    })
  }

  private id(prefix: string): string {
    return `${prefix}${this.nextId++}`
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task)
    this.queue = result.catch(() => undefined)
    return result
  }
}

async function startGame(dir: string, fixed: { seed?: number; gameId?: string } = {}): Promise<{ store: GameStore; state: GameState }> {
  // Fixed-width base-36 time, so names sort by creation.
  const gameId = fixed.gameId ?? `g${Date.now().toString(36).padStart(9, '0')}`
  const store = GameStore.open(join(dir, `${SAVE_PREFIX}${gameId}.sqlite`))
  const state = createNewGame({ gameId, seed: fixed.seed ?? randomInt(2 ** 31) })
  await store.saveSnapshot(state)
  return { store, state }
}

/** The newest game: save names carry their creation time, so they sort by it. */
function latestSave(dir: string): string | null {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(SAVE_PREFIX) && f.endsWith('.sqlite'))
    .sort()
  return files.length > 0 ? join(dir, files.at(-1)!) : null
}
