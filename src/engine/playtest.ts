import { CARD_EFFECT_IDS, EFFECTS, type EffectId } from '@shared/game/catalog'
import type { GameState, Seed } from '@shared/game/schema'
import { createNewGame } from './new-game'
import { checkDecision } from './referee'
import { resolveTurn } from './resolve'
import { createRng, type Rng } from './rng'
import type { Decision } from './scripted-ai'
import { decisionOptions } from './view'

// Bots that play the game through the real pipeline (scripted AI → referee → applyTurn),
// used to check the balance: doing nothing, playing randomly or ruling by force should
// lose; planning around the election should usually win. Dev tool, not part of the app.

export type Bot = (state: GameState, rng: Rng) => Decision[]

type Wish = EffectId | readonly [EffectId, string]

/** Takes the wished decisions in order while the referee would accept them together. */
export function pick(state: GameState, wishes: readonly Wish[]): Decision[] {
  const out: Decision[] = []
  for (const wish of wishes) {
    const [effectId, targetId] = typeof wish === 'string' ? [wish, undefined] : wish
    const option = decisionOptions(state).find((o) => o.effectId === effectId)
    const target = option?.targets.find((t) => targetId === undefined || t.ref.id === targetId)
    if (!target) continue
    if (checkDecision(state, effectId, target.ref, out).length === 0) out.push({ effectId, target: target.ref })
  }
  return out
}

const turnsToElection = (s: GameState): number => s.election.nextTurn - s.turn

export const BOTS: Record<string, Bot> = {
  /** Does nothing. */
  bos: () => [],
  /** Random decisions on random targets. */
  rastgele: (s, rng) => {
    const wishes: Wish[] = []
    for (let i = 0; i < 6; i++) {
      const effectId = CARD_EFFECT_IDS[Math.floor(rng.next() * CARD_EFFECT_IDS.length)]!
      const targets = decisionOptions(s).find((o) => o.effectId === effectId)!.targets
      wishes.push([effectId, targets[Math.floor(rng.next() * targets.length)]!.ref.id])
    }
    return pick(s, wishes)
  },
  /** Every turn, whatever pleases voters right now. */
  populist: (s) => pick(s, ['tax_cut', 'fiscal_stimulus', 'anti_corruption_drive', ['regional_investment', 'TR-34'], ['sanctions', 'GRC']]),
  /** Rules by force. */
  otoriter: (s) => pick(s, ['press_crackdown', 'military_buildup', ['sanctions', 'GRC'], ['sanctions', 'DEU']]),
  /** Builds the economy early, spends popularity right before the vote. */
  dengeli: (s) => {
    const left = turnsToElection(s)
    if (left <= 3) return pick(s, ['tax_cut', 'anti_corruption_drive', ['regional_investment', 'TR-34']])
    if (left >= 9) return pick(s, ['austerity', ['trade_agreement', 'DEU'], ['trade_agreement', 'CHN'], ['regional_investment', 'TR-06']])
    return pick(s, [['trade_agreement', 'DEU'], ['trade_agreement', 'CHN'], ['trade_agreement', 'GRC'], ['regional_investment', 'TR-35'], 'anti_corruption_drive'])
  }
}

export interface TurnTrace {
  turn: number
  bars: GameState['countries'][number]['bars']
  decisions: EffectId[]
  /** Fired seeds this turn; `butterfly` = caused by the player's own decision. */
  fired: Array<{ effectId: EffectId; butterfly: boolean }>
}

export interface GameResult {
  endTurn: number
  ending: 'election_lost' | 'coup' | null
  votes: number[]
  electionsWon: number
  /** Turn of the first butterfly (player-caused) seed that fired. */
  firstButterfly: number | null
  butterflies: number
  worldEvents: number
  minStability: number
  trace: TurnTrace[]
}

/** Plays one game to the end or to `turns`, keeping seeds the way the save file would. */
export async function playGame(bot: Bot, opts: { gameId: string; seed: number; turns: number }): Promise<GameResult> {
  let state = createNewGame({ gameId: opts.gameId, seed: opts.seed })
  const rng = createRng(opts.seed ^ 0x9e3779b9)
  let seeds: Seed[] = []
  const r: GameResult = {
    endTurn: 0,
    ending: null,
    votes: [],
    electionsWon: 0,
    firstButterfly: null,
    butterflies: 0,
    worldEvents: 0,
    minStability: 100,
    trace: []
  }
  while (state.turn < opts.turns && state.status === 'playing') {
    const decisions = bot(state, rng)
    const res = await resolveTurn(state, { decisions, orders: [], candidateSeeds: seeds.filter((s) => s.status === 'dormant') })
    if (!res.ok) throw new Error(`${opts.gameId} turn ${state.turn + 1}: ${JSON.stringify(res.issues)}`)
    const { outcome } = res
    const updated = new Map(outcome.seedUpdates.map((s) => [s.id, s]))
    seeds = [...seeds.map((s) => updated.get(s.id) ?? s), ...outcome.seeds]
    state = outcome.newState

    const me = state.countries.find((c) => c.id === state.playerCountryId)!
    r.minStability = Math.min(r.minStability, me.bars.stability)
    const fired = outcome.report.firedSeeds.map((f) => ({ effectId: f.effectId, butterfly: f.source !== null }))
    const butterflies = fired.filter((f) => f.butterfly).length
    if (butterflies > 0 && r.firstButterfly === null) r.firstButterfly = state.turn
    r.butterflies += butterflies
    r.worldEvents += fired.length - butterflies
    r.trace.push({ turn: state.turn, bars: { ...me.bars }, decisions: decisions.map((d) => d.effectId), fired })

    const e = outcome.report.election
    if (e) {
      r.votes.push(e.vote)
      if (e.won) r.electionsWon++
    }
  }
  r.endTurn = state.turn
  r.ending = state.ending?.kind ?? null
  return r
}

/** One line per turn, for reading a single game. */
export function formatTrace(trace: readonly TurnTrace[]): string[] {
  return trace.map((t) => {
    const b = t.bars
    const fired = t.fired.map((f) => `${f.butterfly ? 'kelebek' : 'dünya'}: ${EFFECTS[f.effectId].label}`).join(' ')
    const decisions = t.decisions.map((d) => EFFECTS[d].label).join(', ')
    return `t${String(t.turn).padStart(2)} onay ${b.approval} ist ${b.stability} eko ${b.economy} ref ${b.welfare} ask ${b.military} | ${decisions} ${fired}`
  })
}
