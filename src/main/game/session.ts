import { randomInt } from 'node:crypto'
import { appendFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { EFFECTS, type EffectId } from '@shared/game/catalog'
import type { EntityRef } from '@shared/game/primitives'
import type { GameState } from '@shared/game/schema'
import type { ActionResult, ChatEntry, GameProgress, GameView } from '@shared/game/view'
import { DEVELOPMENT_TAG } from '@shared/game/impacts'
import { relevantEntities } from '../../engine/context'
import { happeningsFrom } from '../../engine/director'
import { entityName } from '../../engine/lookup'
import { createNewGame } from '../../engine/new-game'
import { checkDecision, explainIssue } from '../../engine/referee'
import { buildView, effectLines, type PendingDecision } from '../../engine/view'
import { GameStore } from '../store/game-store'
import { ScriptedBrain, type BrainCall, type BrainHooks, type Commitment, type GameBrain } from './claude/brain'
import { buildMapView } from './map-view'

/** How many past turns of news the briefing shows. */
const FEED_TURNS = 8
const SAVE_PREFIX = 'oyun-'

export interface SessionOptions {
  /** Who reads orders and plays the world. Default: the scripted rules. */
  brain?: GameBrain
  /** Fixes the dice and id of a new game started by `open`, for reproducible demos and tests. */
  first?: { seed?: number; gameId?: string; electionEveryTurns?: number }
}

/**
 * The running game in the main process: one save file, the decisions picked for the
 * coming month, and the conversation with the cabinet. Calls are queued, so a double
 * click on "end turn" can never play two turns at once.
 *
 * Every AI call is appended to a JSON-lines log next to the save (context → proposal →
 * the referee's verdict → result): a record of the game, and later a dataset.
 */
export class GameSession {
  private pending: PendingDecision[] = []
  private chat: ChatEntry[] = []
  private nextId = 1
  private queue: Promise<unknown> = Promise.resolve()
  private notice: string | null = null
  private progress: (event: GameProgress) => void = () => {}
  private readonly brain: GameBrain

  private constructor(
    private readonly dir: string,
    private store: GameStore,
    private state: GameState,
    private savePath: string,
    opts: SessionOptions
  ) {
    this.brain = opts.brain ?? new ScriptedBrain()
  }

  /** Opens the most recent save in `dir`, or starts a new game if there is none. */
  static async open(dir: string, opts: SessionOptions = {}): Promise<GameSession> {
    mkdirSync(dir, { recursive: true })
    const latest = latestSave(dir)
    if (latest) {
      const store = GameStore.open(latest)
      const state = await store.loadLatestSnapshot()
      if (state) return new GameSession(dir, store, state, latest, opts)
      store.close()
    }
    const { store, state, file } = await startGame(dir, opts.first)
    return new GameSession(dir, store, state, file, opts)
  }

  /** Where live progress (streamed replies, the news being written) goes. */
  onProgress(listener: (event: GameProgress) => void): void {
    this.progress = listener
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
      const { store, state, file } = await startGame(this.dir)
      this.store.close()
      this.store = store
      this.state = state
      this.savePath = file
      this.pending = []
      this.chat = []
      this.notice = null
      return this.buildView()
    })
  }

  /** A typed message: the cabinet answers for free, or turns an order into decisions for this month. */
  command(text: string): Promise<ActionResult> {
    return this.run(async () => {
      const message = text.trim()
      if (this.state.status !== 'playing') return { view: await this.buildView(), ok: false, message: 'Oyun bitti.' }
      const chatId = this.id('c')
      this.progress({ kind: 'chat', chatId, text: message })

      const result = await this.brain.interpret(
        { state: this.state, message, pending: this.commitments(), recentEvents: await this.store.recentEvents({ limit: 30 }) },
        {
          ...this.logHooks(),
          onReply: (reply, attempt) => this.progress({ kind: 'reply', chatId, text: reply, attempt }),
          onRejected: (r) => this.progress({ kind: 'rejected', chatId, attempt: r.attempt, reply: r.reply, reasons: r.reasons })
        }
      )

      for (const d of result.decisions) {
        this.pending.push({ id: this.id('k'), decision: { effectId: d.effectId, target: d.target }, order: message, reason: d.reason })
      }
      this.notice = result.fallback ? `Claude'a ulaşılamadı, kurallı yedek cevap verdi: ${result.fallback}` : null
      this.chat.push({
        id: chatId,
        turn: this.state.turn,
        text: message,
        reply: result.reply,
        kind: result.kind,
        decisions: result.decisions.map((d) => this.decisionLabel(d.effectId, d.target)),
        rejected: result.rejected.map((r) => ({ reply: r.reply, reasons: r.reasons })),
        discussed: result.discussed.map((id) => ({ label: EFFECTS[id].label, lines: effectLines(EFFECTS[id]) })),
        ...(result.fallback ? { fallback: result.fallback } : {})
      })
      return { view: await this.buildView(), ok: result.decisions.length > 0, message: result.reply }
    })
  }

  /** A card clicked on the desk: a shortcut straight to the referee, no AI needed. */
  pick(effectId: EffectId, target: EntityRef): Promise<ActionResult> {
    return this.run(async () => {
      if (this.state.status !== 'playing') return { view: await this.buildView(), ok: false, message: 'Oyun bitti.' }
      const issues = checkDecision(this.state, effectId, target, this.commitments())
      if (issues.length > 0) return { view: await this.buildView(), ok: false, message: explainIssue(issues[0]!) }
      this.pending.push({ id: this.id('k'), decision: { effectId, target }, order: null, reason: null })
      return { view: await this.buildView(), ok: true }
    })
  }

  unpick(id: string): Promise<GameView> {
    return this.run(async () => {
      this.pending = this.pending.filter((p) => p.id !== id)
      return this.buildView()
    })
  }

  /** Plays the month: the AI plays the world, the referee approves, the engine applies, the save file records. */
  endTurn(): Promise<GameView> {
    return this.run(async () => {
      if (this.state.status !== 'playing') return this.buildView()
      const decisions = this.commitments()
      const orders = [...new Set(this.pending.flatMap((p) => (p.order ? [p.order] : [])))]
      const { resolution, fallback } = await this.brain.resolve(
        {
          state: this.state,
          decisions,
          orders,
          dueSeeds: await this.store.dueSeeds(this.state.turn + 1),
          relevantSeeds: await this.store.seedsForEntities(relevantEntities(this.state, orders.join('\n'), decisions), { limit: 12 }),
          recentEvents: await this.store.recentEvents({ limit: 30 }),
          past: happeningsFrom(await this.store.eventsByTag(DEVELOPMENT_TAG, { limit: 12 }))
        },
        {
          ...this.logHooks(),
          onPhase: (phase) => this.progress({ kind: 'phase', phase }),
          onNarration: (delta) => this.progress({ kind: 'narration', delta })
        }
      )
      await this.store.commitTurn(resolution.outcome)
      this.state = resolution.outcome.newState
      this.pending = []
      this.notice = fallback ?? null
      return this.buildView()
    })
  }

  /**
   * Test hook (CS_TEST_HOOKS=1 only, see main/index.ts): hands a province to someone, in
   * memory, without a turn or a save. Lets the proof scripts show the map following GameState.
   */
  debugSetProvince(id: string, owner: string, controller: string): Promise<GameView> {
    return this.run(async () => {
      this.state = { ...this.state, provinces: this.state.provinces.map((p) => (p.id === id ? { ...p, owner, controller } : p)) }
      return this.buildView()
    })
  }

  /** The month's decisions with the reason recorded for each (cards get the catalog's wording). */
  private commitments(): Commitment[] {
    return this.pending.map((p) => ({
      ...p.decision,
      reason: p.reason ?? `${EFFECTS[p.decision.effectId].label}${p.decision.target.id === this.state.playerCountryId ? '' : `: ${entityName(this.state, p.decision.target)}`}.`
    }))
  }

  private decisionLabel(effectId: EffectId, target: EntityRef): string {
    const label = EFFECTS[effectId].label
    return target.id === this.state.playerCountryId ? label : `${label} · ${entityName(this.state, target)}`
  }

  /** Appends each AI call to the save's JSON-lines log. Logging must never break the game. */
  private logHooks(): Pick<BrainHooks, 'onCall'> {
    const file = `${this.savePath.replace(/\.sqlite$/, '')}.log.jsonl`
    return {
      onCall: (call: BrainCall) => {
        try {
          appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), gameId: this.state.gameId, ...call })}\n`)
        } catch (err) {
          console.warn('[oyun] tur kaydı yazılamadı', err)
        }
      }
    }
  }

  private async buildView(): Promise<GameView> {
    const feed = await this.store.feedSince(Math.max(0, this.state.turn - FEED_TURNS + 1))
    const history = await this.store.barHistory(this.state.playerCountryId, 'approval')
    const view = buildView({
      state: this.state,
      feed,
      pending: this.pending,
      chat: this.chat.filter((c) => c.turn > this.state.turn - FEED_TURNS),
      polls: history.map((h) => ({ turn: h.turn, approval: h.value })),
      ai: { kind: this.brain.kind, notice: this.notice }
    })
    return { ...view, map: buildMapView(this.state) }
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

async function startGame(
  dir: string,
  fixed: { seed?: number; gameId?: string; electionEveryTurns?: number } = {}
): Promise<{ store: GameStore; state: GameState; file: string }> {
  // Fixed-width base-36 time, so names sort by creation.
  const gameId = fixed.gameId ?? `g${Date.now().toString(36).padStart(9, '0')}`
  const file = join(dir, `${SAVE_PREFIX}${gameId}.sqlite`)
  const store = GameStore.open(file)
  const state = createNewGame({
    gameId,
    seed: fixed.seed ?? randomInt(2 ** 31),
    ...(fixed.electionEveryTurns ? { electionEveryTurns: fixed.electionEveryTurns } : {})
  })
  await store.saveSnapshot(state)
  return { store, state, file }
}

/** The newest game: save names carry their creation time, so they sort by it. */
function latestSave(dir: string): string | null {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(SAVE_PREFIX) && f.endsWith('.sqlite'))
    .sort()
  return files.length > 0 ? join(dir, files.at(-1)!) : null
}
