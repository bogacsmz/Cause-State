import { EFFECTS, type EffectId } from '@shared/game/catalog'
import { LIMITS, type ChangeList, type SeedPlan, type TurnOutcome } from '@shared/game/contract'
import { MAJOR_TAG, TONE_TAGS, type Beat } from '@shared/game/impacts'
import { BAR_LABELS, countryRef, type EntityRef } from '@shared/game/primitives'
import type { GameEvent, GameState, Seed } from '@shared/game/schema'
import { monthYear } from '@shared/tr'
import type { AiResult, AiUsage } from '@shared/ipc'
import { buildTurnRequest } from '../../../engine/context'
import type { Happening } from '../../../engine/director'
import { entityName, findCountry } from '../../../engine/lookup'
import { checkDecision, explainIssue, formatIssuesForRepair, type RefereeIssue } from '../../../engine/referee'
import { resolveTurn, withNarration, type TurnResolution } from '../../../engine/resolve'
import { monthFocus, spotlight } from '../../../engine/spotlight'
import { fitText } from '../../../engine/util'
import { interpretOrder, scriptedChangeList } from '../../../engine/scripted-ai'
import type { Effort, LlmProvider } from '../../ai/types'
import { INTERPRET_SYSTEM, NARRATE_SYSTEM, RESOLVE_SYSTEM } from './prompts'
import { ORDER_REPLY_SCHEMA, OrderReplyWire, WORLD_REPLY_SCHEMA, WorldReplyWire } from './schemas'
import { parseJsonAnswer, parseNarration, partialStringField } from './text'

// The game's mind. Two implementations behind one interface: Claude (the real thing) and
// the scripted rules from phase 1 (offline play, tests, and the fallback when Claude cannot
// be reached). Either way the referee approves and the code applies; the brain only proposes
// and tells the story.

/** A decision the player's government has committed to this month. */
export interface Commitment {
  effectId: EffectId
  target: EntityRef
  reason: string
}

/** One call to the model, for the turn log and the cost shown to the player. */
export interface BrainCall {
  role: 'interpret' | 'resolve' | 'narrate'
  turn: number
  attempt: number
  model?: string
  durationMs: number
  usage?: AiUsage
  costUsd?: number
  prompt: string
  output: string
  /** What the referee said about this output (empty when accepted). */
  issues: string[]
  error?: string
}

export interface BrainHooks {
  /** The reply so far, while Claude is writing it (attempt starts at 1). */
  onReply?: (textSoFar: string, attempt: number) => void
  /** A proposal the referee turned down, with its reasons in Turkish. */
  onRejected?: (rejected: RejectedAttempt) => void
  onPhase?: (phase: 'world' | 'referee' | 'news') => void
  /** News text as it streams. */
  onNarration?: (delta: string) => void
  onCall?: (call: BrainCall) => void
}

export interface RejectedAttempt {
  attempt: number
  reply: string
  decisions: Commitment[]
  reasons: string[]
}

export interface InterpretInput {
  state: GameState
  message: string
  /** Decisions already committed this month. */
  pending: readonly Commitment[]
  recentEvents: readonly GameEvent[]
}

export interface InterpretResult {
  kind: 'talk' | 'action'
  reply: string
  /** Approved by the referee, ready to be added to the month's plan. */
  decisions: Commitment[]
  /** Moves the reply discussed; the game shows their real numbers. */
  discussed: EffectId[]
  rejected: RejectedAttempt[]
  /** Set when the brain could not be reached and the scripted rules answered instead. */
  fallback?: string
}

export interface ResolveInput {
  state: GameState
  decisions: readonly Commitment[]
  orders: readonly string[]
  /** Dormant seeds whose time has come (planSeeds decides which fire). */
  dueSeeds: readonly Seed[]
  /** Dormant seeds touching what this month is about, for continuity. */
  relevantSeeds: readonly Seed[]
  recentEvents: readonly GameEvent[]
  /** Recent developments and consequences, for the month's pacing (director.ts). */
  past?: readonly Happening[]
}

export interface ResolveResult {
  resolution: Extract<TurnResolution, { ok: true }>
  /** Set when Claude's proposal or narration could not be used and the scripted rules filled in. */
  fallback?: string
}

export interface GameBrain {
  readonly kind: 'claude' | 'scripted'
  interpret(input: InterpretInput, hooks?: BrainHooks): Promise<InterpretResult>
  resolve(input: ResolveInput, hooks?: BrainHooks): Promise<ResolveResult>
}

// ── the scripted brain (phase 1 rules) ─────────────────────────────────────────

export class ScriptedBrain implements GameBrain {
  readonly kind = 'scripted' as const

  async interpret(input: InterpretInput, hooks: BrainHooks = {}): Promise<InterpretResult> {
    const result = interpretOrder(input.state, input.message, input.pending)
    hooks.onReply?.(result.reply, 1)
    return {
      kind: result.kind === 'decision' ? 'action' : 'talk',
      reply: result.reply,
      decisions: result.kind === 'decision' ? [{ ...result.decision, reason: `${EFFECTS[result.decision.effectId].label}: ${input.message}` }] : [],
      discussed: [],
      rejected: []
    }
  }

  async resolve(input: ResolveInput, hooks: BrainHooks = {}): Promise<ResolveResult> {
    const resolution = await resolveTurn(input.state, turnInput(input))
    if (!resolution.ok) throw new Error(`scripted turn rejected: ${resolution.issues.map((i) => i.message).join('; ')}`)
    const { narration } = resolution.outcome
    hooks.onNarration?.(`${narration.headline}\n\n${narration.body}`)
    return { resolution }
  }
}

// ── Claude ─────────────────────────────────────────────────────────────────────

export interface ClaudeBrainOptions {
  /** Model per call; undefined = the provider's own setting. */
  model?: string
  efforts?: Partial<Record<BrainCall['role'], Effort>>
  /** Referee rounds before giving up (propose → validate → repair). */
  maxAttempts?: number
}

const DEFAULT_EFFORTS: Record<BrainCall['role'], Effort> = { interpret: 'low', resolve: 'medium', narrate: 'low' }

export class ClaudeBrain implements GameBrain {
  readonly kind = 'claude' as const
  private readonly scripted = new ScriptedBrain()

  constructor(
    private readonly provider: LlmProvider,
    private readonly opts: ClaudeBrainOptions = {}
  ) {}

  /** Reads a typed message: free talk, or catalog moves checked by the referee (with repairs). */
  async interpret(input: InterpretInput, hooks: BrainHooks = {}): Promise<InterpretResult> {
    const { state } = input
    const request = buildTurnRequest({
      state,
      order: input.message,
      recentEvents: input.recentEvents,
      // Hidden seeds stay hidden from the cabinet too: consequences should surprise.
      candidateSeeds: [],
      decisions: input.pending
    })
    const capitalLeft = state.politicalCapital.current - input.pending.reduce((n, d) => n + EFFECTS[d.effectId].cost, 0)
    const base = JSON.stringify({ playing: playing(state), ...request, capitalLeft, message: input.message })

    const rejected: RejectedAttempt[] = []
    let feedback: string | null = null
    const attempts = this.opts.maxAttempts ?? 3

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const prompt = feedback ? `${base}\n\n${feedback}` : base
      let streamed = ''
      let shown = ''
      let answer: AiResult
      try {
        answer = await this.call('interpret', state.turn, attempt, prompt, INTERPRET_SYSTEM, hooks, {
          log: false,
          schema: ORDER_REPLY_SCHEMA,
          onText: (delta) => {
            streamed += delta
            const reply = partialStringField(streamed, 'reply')
            if (reply !== null && reply !== shown) {
              shown = reply
              hooks.onReply?.(reply, attempt)
            }
          }
        })
      } catch (err) {
        return { ...(await this.scripted.interpret(input, hooks)), rejected, fallback: errorText(err) }
      }

      const log = (issues: string[]): void => hooks.onCall?.(callRecord('interpret', state.turn, attempt, prompt, answer, issues))
      const parsed = OrderReplyWire.safeParse(safeJson(answer.text))
      if (!parsed.success) {
        feedback = `Your answer did not match the required JSON shape: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}. Answer again with one valid JSON document.`
        log([feedback])
        continue
      }
      const reply = parsed.data
      hooks.onReply?.(reply.reply, attempt)
      const discussed = [...new Set(reply.discussed)].slice(0, 3) as EffectId[]
      const decisions = reply.decisions.map((d) => ({ effectId: d.effectId as EffectId, target: d.target as EntityRef, reason: fitText(d.reason, LIMITS.reasonChars) }))

      if (reply.kind === 'talk' || decisions.length === 0) {
        log([])
        return { kind: reply.kind === 'talk' ? 'talk' : 'action', reply: reply.reply, decisions: [], discussed, rejected }
      }

      // The referee checks the whole proposal against the month's plan, in order.
      const issues: RefereeIssue[] = []
      const accepted: Commitment[] = []
      decisions.forEach((d, i) => {
        const found = checkDecision(state, d.effectId, d.target, [...input.pending, ...accepted])
        issues.push(...found.map((issue) => ({ ...issue, path: `decisions[${i}]` })))
        if (found.length === 0) accepted.push(d)
      })
      if (issues.length === 0) {
        log([])
        return { kind: 'action', reply: reply.reply, decisions, discussed, rejected }
      }

      const turned: RejectedAttempt = {
        attempt,
        reply: reply.reply,
        decisions,
        reasons: [...new Set(issues.map((i) => `${EFFECTS[decisions[Number(i.path.match(/\d+/)?.[0] ?? 0)]!.effectId].label}: ${explainIssue(i)}`))]
      }
      rejected.push(turned)
      hooks.onRejected?.(turned)
      log(issues.map((i) => `${i.path}: ${i.message}`))
      feedback = `${formatIssuesForRepair(issues)}\nThe order stays the same. If what failed cannot be done under these rules, do not try it again: propose what realistically happens when the government attempts it (usually reckless_gambit on TUR), or the feasible part only, and tell the player in the reply what was tried, why it failed and what it cost.`
    }

    const last = rejected.at(-1)
    return {
      kind: 'action',
      reply: last ? `${last.reply} (Hakem bu hamleyi onaylamadı.)` : 'Emrinizi uygulanabilir bir karara çeviremedim.',
      decisions: [],
      discussed: [],
      rejected
    }
  }

  /** Plays the month: Claude is the world, the referee approves, the code applies, Claude tells the news. */
  async resolve(input: ResolveInput, hooks: BrainHooks = {}): Promise<ResolveResult> {
    const { state } = input
    const orders = input.orders.join('\n')
    let fallback: string | undefined
    // Each world proposal is logged once the referee has judged it: its objections arrive
    // as the next attempt's feedback, or with the final resolution.
    let unjudged: BrainCall | null = null
    const judge = (issues: string[]): void => {
      if (unjudged) hooks.onCall?.({ ...unjudged, issues })
      unjudged = null
    }

    const makeProposer = (plan: SeedPlan) => {
      let attempt = 0
      const beat = plan.beat ?? null
      return async (refereeSays: string | null): Promise<unknown> => {
        attempt += 1
        // The referee speaks in ChangeList fields; Claude answered in the world reply's.
        const feedback = refereeSays ? toWireNames(refereeSays) : null
        judge(feedback ? feedback.split('\n').flatMap((line) => (line.startsWith('- ') ? [line.slice(2)] : [])) : [])
        hooks.onPhase?.('world')
        const request = buildTurnRequest({
          state,
          order: orders,
          recentEvents: input.recentEvents,
          candidateSeeds: [...input.dueSeeds, ...input.relevantSeeds],
          firing: plan.firing,
          decisions: input.decisions,
          // The code decides who may answer and where the month's development starts; Claude decides what.
          focus: monthFocus(state, input.decisions, beat)
        })
        const payload = JSON.stringify({
          playing: playing(state),
          reactors: spotlight(state, input.decisions),
          development: beat ? beatForPrompt(beat) : null,
          consequenceScale: plan.seedScale ?? 'minor',
          ...(plan.seedTone ? { consequenceTone: plan.seedTone } : {}),
          ...request
        })
        const prompt = feedback
          ? `${payload}\n\nThe referee rejected your previous answer. Fix every problem and answer again with the complete JSON document.\n${feedback}`
          : payload
        const answer = await this.call('resolve', state.turn, attempt, prompt, RESOLVE_SYSTEM, hooks, { schema: WORLD_REPLY_SCHEMA, log: false })
        unjudged = callRecord('resolve', state.turn, attempt, prompt, answer, [])
        hooks.onPhase?.('referee')
        const raw = safeJson(answer.text)
        const world = WorldReplyWire.safeParse(raw)
        // A malformed answer still goes to the referee, field by field: its checks send the reasons back.
        return world.success ? worldProposal(world.data, input.decisions) : looseWorldProposal(raw, input.decisions)
      }
    }

    let resolution: TurnResolution
    try {
      resolution = await resolveTurn(state, turnInput(input), makeProposer)
      judge(resolution.ok ? [] : resolution.issues.map((i) => `${i.path || '(root)'}: ${i.message}`))
    } catch (err) {
      judge([`(no verdict: ${errorText(err)})`])
      fallback = `Dünya hamlesi için Claude'a ulaşılamadı (${errorText(err)}); kurallı yedek kullanıldı.`
      resolution = await resolveTurn(state, turnInput(input))
    }
    if (!resolution.ok) {
      fallback = `Claude'un dünya önerisi hakemden geçmedi (${resolution.issues.map((i) => i.message).join('; ')}); kurallı yedek kullanıldı.`
      resolution = await resolveTurn(state, turnInput(input))
    }
    if (!resolution.ok) throw new Error('the scripted fallback was rejected too')

    hooks.onPhase?.('news')
    let narration: ReturnType<typeof parseNarration> = null
    try {
      narration = await this.narrate(state, resolution.outcome, input.recentEvents, hooks)
      if (!narration) fallback ??= 'Haber metni okunamadı; kurallı yedek anlatım kullanıldı.'
    } catch (err) {
      fallback ??= `Haber için Claude'a ulaşılamadı (${errorText(err)}); kurallı yedek anlatım kullanıldı.`
    }
    if (!narration) {
      // The scripted rules write a plain report of the month instead.
      narration = scriptedChangeList(state, { decisions: input.decisions, orders: input.orders, plan: resolution.plan }).narration
      hooks.onNarration?.(`${narration.headline}\n\n${narration.body}`)
    }
    resolution = { ...resolution, outcome: withNarration(resolution.outcome, narration) }
    return { resolution, ...(fallback ? { fallback } : {}) }
  }

  private async narrate(before: GameState, outcome: TurnOutcome, recentEvents: readonly GameEvent[], hooks: BrainHooks) {
    const facts = narrationFacts(before, outcome, recentEvents)
    const answer = await this.call('narrate', outcome.newState.turn, 1, JSON.stringify(facts), NARRATE_SYSTEM, hooks, {
      onText: (delta) => hooks.onNarration?.(delta)
    })
    return parseNarration(answer.text)
  }

  private async call(
    role: BrainCall['role'],
    turn: number,
    attempt: number,
    prompt: string,
    system: string,
    hooks: BrainHooks,
    extra: { schema?: Record<string, unknown>; onText?: (delta: string) => void; log?: boolean }
  ): Promise<AiResult> {
    const started = Date.now()
    const { log = true, ...options } = extra
    try {
      const result = await this.provider.generate({
        system,
        prompt,
        effort: this.opts.efforts?.[role] ?? DEFAULT_EFFORTS[role],
        ...(this.opts.model ? { model: this.opts.model } : {}),
        ...options
      })
      // Interpretations and world proposals are logged by the caller, once the referee's verdict is known.
      if (log) hooks.onCall?.(callRecord(role, turn, attempt, prompt, result, []))
      return result
    } catch (err) {
      hooks.onCall?.({ role, turn, attempt, durationMs: Date.now() - started, prompt, output: '', issues: [], error: errorText(err) })
      throw err
    }
  }
}

function callRecord(role: BrainCall['role'], turn: number, attempt: number, prompt: string, result: AiResult, issues: string[]): BrainCall {
  return {
    role,
    turn,
    attempt,
    ...(result.model ? { model: result.model } : {}),
    durationMs: result.durationMs,
    ...(result.usage ? { usage: result.usage } : {}),
    ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
    prompt,
    output: result.text,
    issues
  }
}

/** What the newsroom may report: only what the code applied this month. */
export function narrationFacts(before: GameState, outcome: TurnOutcome, recentEvents: readonly GameEvent[]) {
  const state = outcome.newState
  const player = state.playerCountryId
  const name = (ref: EntityRef): string => entityName(state, ref)
  const of = (kind: GameEvent['kind']) => outcome.events.filter((e) => e.kind === kind)
  const report = outcome.report
  const seedById = new Map([...outcome.seedUpdates].map((s) => [s.id, s]))
  const toneOf = (e: GameEvent): string =>
    (Object.entries(TONE_TAGS).find(([, tag]) => e.tags.includes(tag))?.[0] ?? 'neutral') + (e.tags.includes(MAJOR_TAG) ? ', major' : '')
  const others = (e: GameEvent): string | null => {
    const ref = e.entities.find((r) => r.type === 'country' && r.id !== player)
    return ref ? name(ref) : null
  }

  const decisions = of('effect_applied').map((e) => ({
    move: e.effectId ? EFFECTS[e.effectId].label : e.title,
    target: e.entities.find((r) => r.id !== player) ? name(e.entities.find((r) => r.id !== player)!) : null,
    what: e.summary
  }))
  const reactions = of('foreign_action').map((e) => ({ country: others(e), move: e.effectId ? EFFECTS[e.effectId].label : e.title, what: e.summary }))
  const developments = of('development').map((e) => ({ title: e.title, story: e.summary, tone: toneOf(e), where: others(e) }))
  const consequences = of('seed_fired').map((e) => {
    const seed = e.seedId ? seedById.get(e.seedId) : undefined
    return {
      title: e.title,
      what: e.summary,
      tone: toneOf(e),
      grewFrom: seed
        ? {
            month: monthYear(monthOfTurn(before, seed.plantedTurn)),
            turn: seed.plantedTurn,
            decision: seed.sourceEffectId ? EFFECTS[seed.sourceEffectId].label : 'dünyadaki bir gelişme'
          }
        : null
    }
  })

  return {
    month: monthYear(state.date),
    turn: state.turn,
    country: findCountry(state, player)?.name ?? player,
    quiet: decisions.length + reactions.length + developments.length + consequences.length === 0 && !report.election && !report.coup,
    decisions,
    reactions,
    developments,
    consequences,
    brewing: outcome.seeds.filter((s) => s.sourceEffectId === null).map((s) => s.hook),
    election: report.election,
    coup: report.coup ? { chancePercent: Math.round(report.coup.chance * 100), happened: report.coup.happened } : null,
    ending: state.ending ? { title: state.ending.title, detail: state.ending.detail } : null,
    poll: findCountry(state, player)?.bars.approval ?? null,
    bars: report.bars
      .filter((b) => b.after !== b.before)
      .map((b) => ({
        bar: BAR_LABELS[b.bar],
        direction: b.after > b.before ? 'yükseldi' : 'düştü',
        because: b.causes.filter((c) => c.kind !== 'noise').map((c) => c.label).slice(0, 4)
      })),
    running: state.effects
      .filter((e) => e.source === 'player' && e.appliedTurn < state.turn)
      .map((e) => e.label ?? EFFECTS[e.effectId].label)
      .slice(0, 5),
    ended: report.expired,
    recentHeadlines: recentEvents
      .filter((e) => e.kind === 'narration')
      .sort((a, b) => b.turn - a.turn)
      .slice(0, 5)
      .map((e) => e.title)
  }
}

/** The month's development slot as Claude reads it. */
function beatForPrompt(beat: Beat): { tone: Beat['tone']; scale: Beat['scale']; stage: Beat['stage']['kind']; country?: string } {
  return { tone: beat.tone, scale: beat.scale, stage: beat.stage.kind, ...(beat.stage.kind === 'country' ? { country: beat.stage.id } : {}) }
}

/** Claude's world answer as a ChangeList: the player's approved decisions plus the world's month. */
export function worldProposal(world: WorldReplyWire, decisions: readonly Commitment[]): ChangeList {
  const d = world.development
  // Prose that runs long is trimmed here rather than sent back for a repair round.
  const title = (t: string): string => fitText(t, LIMITS.titleChars)
  const prose = (t: string): string => fitText(t, LIMITS.reasonChars)
  return {
    interpretation: fitText(world.interpretation, 400),
    changes: decisions.map((c) => ({ effectId: c.effectId, target: c.target, reason: prose(c.reason) })),
    foreignIntents: world.reactions.map((r) => ({ ...r, reason: prose(r.reason) })) as ChangeList['foreignIntents'],
    developments: d
      ? [
          {
            title: title(d.title),
            story: prose(d.story),
            actor: d.actor,
            target: countryRef(d.target),
            moves: d.moves as EffectId[],
            impacts: d.impacts,
            lasts: d.lasts
          }
        ]
      : [],
    newSeeds: world.newSeeds.map((n) => ({ ...n, hook: fitText(n.hook, LIMITS.seedHookChars) })) as ChangeList['newSeeds'],
    seedOutcomes: world.consequences.map((c) => ({
      seedId: c.seedId,
      actor: c.actor,
      effectId: c.effectId as EffectId | null,
      target: c.target as EntityRef | null,
      reason: prose(c.reason),
      title: title(c.title),
      impacts: c.impacts,
      lasts: c.lasts
    })),
    // Placeholder: the newsroom writes the real story once the code has applied the month.
    narration: { headline: 'Ayın haberi', body: 'Haber, kod ayı uyguladıktan sonra yazılır.' }
  }
}

/** A world answer that did not match the schema, mapped field by field so the referee can say what is wrong. */
function looseWorldProposal(raw: unknown, decisions: readonly Commitment[]): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const r = raw as Record<string, unknown>
  const d = r.development as Record<string, unknown> | null | undefined
  return {
    interpretation: r.interpretation,
    changes: decisions.map((c) => ({ effectId: c.effectId, target: c.target, reason: c.reason })),
    foreignIntents: r.reactions,
    developments: d && typeof d === 'object' ? [{ ...d, target: typeof d.target === 'string' ? countryRef(d.target) : d.target }] : [],
    newSeeds: r.newSeeds,
    seedOutcomes: r.consequences,
    narration: { headline: 'Ayın haberi', body: 'Haber, kod ayı uyguladıktan sonra yazılır.' }
  }
}

/** The referee's paths, renamed to the fields of the world reply Claude writes. */
function toWireNames(text: string): string {
  return text
    .replaceAll('foreignIntents', 'reactions')
    .replaceAll('seedOutcomes', 'consequences')
    .replace(/developments\[0\]/g, 'development')
    .replaceAll('ChangeList', 'answer')
}

function turnInput(input: ResolveInput) {
  return { decisions: input.decisions, orders: input.orders, candidateSeeds: input.dueSeeds, past: input.past ?? [] }
}

/** The month the player is playing now: the turn it becomes and its Turkish name. */
function playing(state: GameState): { turn: number; month: string } {
  return { turn: state.turn + 1, month: monthYear(monthOfTurn(state, state.turn + 1)) }
}

/** The calendar date of a turn (one turn = one month, counted from the given state). */
function monthOfTurn(state: GameState, turn: number): string {
  const [y, m] = state.date.split('-').map(Number) as [number, number]
  const total = y * 12 + (m - 1) - (state.turn - turn)
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`
}

function safeJson(text: string): unknown {
  try {
    return parseJsonAnswer(text)
  } catch {
    return { unparsable: text.slice(0, 200) }
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

