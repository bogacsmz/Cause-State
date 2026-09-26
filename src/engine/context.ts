import { EFFECTS } from '@shared/game/catalog'
import { LIMITS, TurnRequest, type ProposedChange } from '@shared/game/contract'
import { entityKey, type EntityRef } from '@shared/game/primitives'
import type { ActiveEffect, GameEvent, GameState, Seed } from '@shared/game/schema'
import { worldBookFor } from '@shared/game/world-book'
import { findCountry, owningCountry } from './lookup'
import { estimateTokens, truncate } from './util'

// Builds what the LLM sees each turn. Everything is capped, so the request stays the
// same size whether the log holds fifty events or fifty thousand: long games don't get
// slower or more expensive, and nothing old is lost, because it stays queryable in SQLite.

/** Extra names players use for countries (matched at the start of a word). */
const ALIASES: Record<string, readonly string[]> = {
  USA: ['abd', 'amerika', 'washington', 'beyaz saray'],
  GRC: ['yunan', 'atina'],
  DEU: ['alman', 'berlin'],
  FRA: ['fransız', 'paris'],
  RUS: ['rus', 'moskova', 'kremlin'],
  CHN: ['çin', 'pekin'],
  IRN: ['iran', 'tahran'],
  GBR: ['ingiltere', 'ingiliz', 'britanya', 'londra'],
  UKR: ['ukrayna', 'kiev', 'kyiv'],
  SYR: ['suriye', 'şam'],
  IRQ: ['irak', 'bağdat', 'erbil'],
  ISR: ['israil', 'tel aviv'],
  SAU: ['suudi', 'riyad'],
  AZE: ['azerbaycan', 'azeri', 'bakü'],
  EGY: ['mısır', 'kahire']
}

export interface TurnContextInput {
  state: GameState
  order: string
  /** Recent events from the log (store query); extra ones are fine, they get cut. */
  recentEvents: readonly GameEvent[]
  /** Dormant seeds touching the entities in play, plus any already due (store query). */
  candidateSeeds: readonly Seed[]
  /** Seeds the code decided fire this turn (from planSeeds). */
  firing?: readonly Seed[]
  /** Decisions already committed this month (approved by the referee). */
  decisions?: readonly ProposedChange[]
}

/** Countries and provinces the order text talks about. */
export function mentionedEntities(state: GameState, text: string): EntityRef[] {
  const haystack = text.toLocaleLowerCase('tr')
  const refs: EntityRef[] = []
  for (const c of state.countries) {
    const names = [c.name, ...(ALIASES[c.id] ?? [])]
    if (names.some((n) => mentions(haystack, n)) || new RegExp(`\\b${c.id}\\b`).test(text)) refs.push({ type: 'country', id: c.id })
  }
  for (const p of state.provinces) {
    if (mentions(haystack, p.name)) refs.push({ type: 'province', id: p.id })
  }
  return refs
}

/** The player's country, everything the order mentions and every decision's target: what seeds are fetched by. */
export function relevantEntities(state: GameState, order: string, decisions: readonly ProposedChange[] = []): EntityRef[] {
  const refs: EntityRef[] = [
    { type: 'country', id: state.playerCountryId },
    ...decisions.map((d) => d.target),
    ...mentionedEntities(state, order)
  ]
  return refs.filter((r, i) => refs.findIndex((o) => entityKey(o) === entityKey(r)) === i)
}

/** Running arrangements between the player and another country, most recent first. */
function tiesWith(state: GameState, countryId: string): string[] {
  const player = state.playerCountryId
  const touches = (e: ActiveEffect): boolean => {
    const target = owningCountry(state, e.target)
    return (e.actor === player && target === countryId) || (e.actor === countryId && target === player)
  }
  return state.effects
    .filter(touches)
    .sort((a, b) => b.appliedTurn - a.appliedTurn)
    .slice(0, LIMITS.ties)
    .map((e) => {
      const left = e.expiresTurn === null ? 'permanent' : `${Math.max(0, e.expiresTurn - state.turn - 1)} turns left`
      return `${e.effectId} ${e.actor}→${owningCountry(state, e.target) ?? e.target.id} (${left})`
    })
}

export function buildTurnRequest(input: TurnContextInput): TurnRequest {
  const { state } = input
  const player = findCountry(state, state.playerCountryId)
  if (!player) throw new Error(`player country ${state.playerCountryId} missing`)

  const decisions = input.decisions ?? []
  const relevant = new Set(relevantEntities(state, input.order, decisions).map(entityKey))

  const activeEffects = state.effects
    .filter((e) => e.actor === player.id || e.modifiers.some((m) => m.country === player.id))
    .sort((a, b) => b.appliedTurn - a.appliedTurn)
    .slice(0, LIMITS.activeEffects)
    .map((e) => ({
      effectId: e.effectId,
      label: EFFECTS[e.effectId].label,
      actor: e.actor,
      target: e.target,
      turnsLeft: e.expiresTurn === null ? null : Math.max(0, e.expiresTurn - state.turn)
    }))

  const recent = input.recentEvents
    .filter((e) => e.visibility === 'public')
    .sort((a, b) => b.turn - a.turn || b.id.localeCompare(a.id))
    .slice(0, LIMITS.recentEvents)

  // Other countries, most relevant first: named in the order or targeted, then tied to us by
  // something running, then in recent news, then the rest.
  const inNews = new Set(recent.flatMap((e) => e.entities).map(entityKey))
  const ranked = state.countries
    .filter((c) => c.id !== player.id)
    .map((c, index) => {
      const key = `country:${c.id}`
      const ties = tiesWith(state, c.id)
      return { c, index, ties, rank: relevant.has(key) ? 0 : ties.length > 0 ? 1 : inNews.has(key) ? 2 : 3 }
    })
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, LIMITS.worldCountries)
  const world = ranked.map(({ c, ties }) => ({ id: c.id, name: c.name, regime: c.regime, bars: { ...c.bars }, ties }))
  const worldBook = worldBookFor(ranked.map(({ c }) => c.id)).slice(0, LIMITS.worldBookEntries)

  // Seeds: ones due to wake first, then those touching what this turn is about.
  const firingIds = new Set((input.firing ?? []).map((s) => s.id))
  const seeds = input.candidateSeeds
    .filter((s) => s.status === 'dormant' && !firingIds.has(s.id))
    .map((s) => ({
      s,
      due: s.wakeTurn <= state.turn,
      overlap: s.entities.filter((r) => relevant.has(entityKey(r))).length
    }))
    .sort((a, b) => Number(b.due) - Number(a.due) || b.overlap - a.overlap || a.s.wakeTurn - b.s.wakeTurn)
    .slice(0, LIMITS.relevantSeeds)
    .map(({ s, due }) => ({
      id: s.id,
      hook: truncate(s.hook, LIMITS.seedHookChars),
      entities: s.entities.slice(0, 4),
      tags: s.tags.slice(0, 5),
      due
    }))

  return TurnRequest.parse({
    turn: state.turn,
    date: state.date,
    player: {
      country: player.id,
      name: player.name,
      regime: player.regime,
      bars: { ...player.bars },
      politicalCapital: state.politicalCapital.current,
      nextElection: player.nextElection,
      election: { turnsLeft: Math.max(0, state.election.nextTurn - state.turn), threshold: state.election.threshold },
      activeEffects
    },
    world,
    worldBook,
    recentEvents: recent.map((e) => ({
      turn: e.turn,
      title: e.title,
      summary: truncate(e.summary, LIMITS.eventSummaryChars)
    })),
    seeds,
    firingSeeds: (input.firing ?? []).slice(0, LIMITS.firingSeeds).map((s) => ({
      id: s.id,
      plantedTurn: s.plantedTurn,
      hook: truncate(s.hook, LIMITS.seedHookChars),
      entities: s.entities.slice(0, 4),
      tags: s.tags.slice(0, 5)
    })),
    decisions: decisions.slice(0, LIMITS.changes).map((d) => ({
      effectId: d.effectId,
      label: EFFECTS[d.effectId].label,
      target: d.target,
      reason: truncate(d.reason, LIMITS.reasonChars)
    })),
    order: input.order.trim() ? truncate(input.order, LIMITS.orderChars) : ''
  })
}

export function turnRequestTokens(req: TurnRequest): number {
  return estimateTokens(JSON.stringify(req))
}

function mentions(haystack: string, name: string): boolean {
  const needle = name.toLocaleLowerCase('tr')
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return false
    const before = at === 0 ? '' : haystack[at - 1]
    // Must start a word; Turkish suffixes after it ("Yunanistan'la", "Fransa'ya") are fine.
    if (!before || !/\p{L}/u.test(before)) return true
    from = at + 1
  }
}
