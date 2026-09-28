import { EFFECTS, type EffectId } from '@shared/game/catalog'
import { LIMITS, type TurnAction, type TurnOutcome } from '@shared/game/contract'
import { DEVELOPMENT_TAG, impactDelta, LASTS_TURNS, MAJOR_TAG, SCALE_LIMITS, TONE_TAGS, toneOfWeight, type Impact } from '@shared/game/impacts'
import { BAR_IDS, countryRef, entityKey, type Bars, type EntityRef } from '@shared/game/primitives'
import type { ActiveEffect, BarChange, GameEvent, GameState, Seed, TurnReport } from '@shared/game/schema'
import { ek } from '@shared/tr'
import { clamp, coupChance, tickBars } from './dynamics'
import { entityName, findCountry, owningCountry } from './lookup'
import { createRng } from './rng'
import { DORMANCY_TURNS } from './seeds'
import { addMonths, formatId, truncate, uniqueTags } from './util'
import { developmentWeightOn, outcomeWeightOn } from './weight'

export const MONTHS_PER_TURN = 1
/** Approval bump for winning an election. */
export const ELECTION_WIN_BONUS = 3
/** Luck in the vote, in points either way. */
export const ELECTION_LUCK = 5

/**
 * Advances the world by one turn. Pure: same state + same action → same outcome.
 *
 * Order: the approved changes and fired seeds become active effects → every bar moves
 * (effects, then natural drift) → effects that ran out end → election, if due → coup
 * check → political capital refills. Everything numeric happens here, in code.
 */
export function applyTurn(state: GameState, action: TurnAction): TurnOutcome {
  if (state.status !== 'playing') throw new Error('the game is over')

  const next = structuredClone(state)
  next.turn += 1
  next.date = addMonths(state.date, MONTHS_PER_TURN)
  const rng = createRng(state.rng)
  const { changes, plan } = action
  const player = next.playerCountryId
  const startBars = new Map<string, Bars>(state.countries.map((c) => [c.id, { ...c.bars }]))

  const events: GameEvent[] = []
  const seeds: Seed[] = []
  const seedUpdates: Seed[] = []
  const record = (partial: Omit<GameEvent, 'id' | 'turn' | 'date'>): GameEvent => {
    const event: GameEvent = { id: formatId('ev', next.counters.event++), turn: next.turn, date: next.date, ...partial }
    events.push(event)
    return event
  }

  const orderText = action.order.trim()
  const order =
    orderText || changes.changes.length > 0
      ? record({
          kind: 'order',
          visibility: 'public',
          title: truncate(orderText || changes.changes.map((c) => EFFECTS[c.effectId].label).join(', '), 160),
          summary: changes.interpretation,
          entities: dedupe([countryRef(player), ...changes.changes.map((c) => c.target)]),
          tags: ['emir'],
          causeId: null
        })
      : null

  let spent = 0
  /** Puts an effect in force. Catalog numbers unless `modifiers` (an improvised development) are given. */
  const addEffect = (a: {
    effectId: EffectId
    actor: string
    target: EntityRef
    source: ActiveEffect['source']
    originEventId: string
    seed?: Seed
    label?: string
    modifiers?: ActiveEffect['modifiers']
    durationTurns?: number
  }): ActiveEffect['modifiers'] => {
    const def = EFFECTS[a.effectId]
    const targetCountry = owningCountry(next, a.target) ?? a.actor
    const modifiers =
      a.modifiers ??
      def.modifiers.map((m) => ({ country: m.on === 'actor' ? a.actor : targetCountry, bar: m.bar, delta: m.delta, mode: m.mode }))
    const duration = a.durationTurns ?? def.durationTurns
    next.effects.push({
      id: formatId('fx', next.counters.effect++),
      effectId: a.effectId,
      actor: a.actor,
      target: a.target,
      source: a.source,
      seedId: a.seed?.id ?? null,
      ...(a.label ? { label: truncate(a.label, LIMITS.titleChars) } : {}),
      appliedTurn: next.turn,
      expiresTurn: duration === null ? null : next.turn + duration,
      modifiers,
      originEventId: a.originEventId
    })
    if (a.source === 'player') spent += def.cost
    return modifiers
  }

  /** Improvised impacts, as numbers from the code's table, landing on the target's country. */
  const improvised = (impacts: readonly Impact[], target: EntityRef, actor: string): ActiveEffect['modifiers'] => {
    const country = owningCountry(next, target) ?? actor
    return impacts.map((i) => ({ country, bar: i.bar, delta: impactDelta(i), mode: i.monthly ? ('per_turn' as const) : ('once' as const) }))
  }

  /** A decision or another country's move: one line of history and the effect it puts in force. */
  const applyMove = (a: { effectId: EffectId; actor: string; target: EntityRef; source: 'player' | 'foreign'; reason: string; causeId: string | null }): void => {
    const def = EFFECTS[a.effectId]
    const targetCountry = owningCountry(next, a.target) ?? a.actor
    const event = record({
      kind: a.source === 'player' ? 'effect_applied' : 'foreign_action',
      visibility: 'public',
      title: truncate(targetCountry === a.actor && a.target.type === 'country' ? def.label : `${def.label}: ${entityName(next, a.target)}`, 160),
      summary: a.reason,
      entities: dedupe([
        countryRef(a.actor),
        a.target,
        ...def.modifiers.map((m) => countryRef(m.on === 'actor' ? a.actor : targetCountry))
      ]),
      tags: uniqueTags(def.tags),
      causeId: a.causeId,
      effectId: a.effectId
    })
    addEffect({ ...a, originEventId: event.id })
  }

  for (const c of changes.changes) {
    applyMove({ effectId: c.effectId, actor: player, target: c.target, source: 'player', reason: c.reason, causeId: order?.id ?? null })
  }
  for (const f of changes.foreignIntents) {
    applyMove({ effectId: f.effectId, actor: f.actor, target: f.target, source: 'foreign', reason: f.reason, causeId: order?.id ?? null })
  }

  // The world's own development this month: the code chose the moment and the tone, the AI the story.
  const beat = plan.beat ?? null
  for (const d of changes.developments) {
    const actor = d.actor ?? owningCountry(next, d.target) ?? player
    const source = d.actor ? 'foreign' : 'world'
    const tone = beat?.tone ?? toneOfWeight(developmentWeightOn(next, d, player))
    const event = record({
      kind: 'development',
      visibility: 'public',
      title: truncate(d.title, 160),
      summary: d.story,
      entities: dedupe([countryRef(player), ...(d.actor ? [countryRef(d.actor)] : []), d.target]),
      tags: uniqueTags([DEVELOPMENT_TAG, TONE_TAGS[tone], ...(beat?.scale === 'major' ? [MAJOR_TAG] : []), ...d.moves.flatMap((id) => EFFECTS[id].tags)]),
      causeId: null,
      ...(d.moves[0] ? { effectId: d.moves[0] } : d.impacts.length > 0 ? { effectId: 'improvised' as const } : {})
    })
    for (const effectId of d.moves) addEffect({ effectId, actor, target: d.target, source, originEventId: event.id, label: d.title })
    if (d.impacts.length > 0) {
      addEffect({
        effectId: 'improvised',
        actor,
        target: d.target,
        source,
        originEventId: event.id,
        label: d.title,
        modifiers: improvised(d.impacts, d.target, actor),
        durationTurns: LASTS_TURNS[d.lasts]
      })
    }
  }

  // Fired seeds: the code chose the moment, the (fake or real) AI chose the outcome. They are
  // told as news of their own; where they came from lives in the record and in the story.
  const firedSeeds: TurnReport['firedSeeds'] = []
  for (const seed of plan.firing) {
    const outcome = changes.seedOutcomes.find((o) => o.seedId === seed.id)
    if (!outcome) throw new Error(`firing seed ${seed.id} has no outcome; the referee should have caught this`)
    const origin = seedOrigin(seed)
    const target = outcome.target ?? countryRef(player)
    const actor = outcome.actor ?? owningCountry(next, target) ?? player
    const source = outcome.actor ? 'foreign' : 'world'
    const weight = outcomeWeightOn(next, outcome, player)
    const tone = plan.seedTone ?? toneOfWeight(weight)
    const move = outcome.effectId && outcome.target ? outcome.effectId : null
    const title =
      outcome.title ?? (move ? `${EFFECTS[move].label}${actor === player ? '' : ` · ${entityName(next, countryRef(actor))}`}` : 'Geçmişin yankısı')
    const event = record({
      kind: 'seed_fired',
      visibility: 'public',
      title: truncate(title, 160),
      summary: outcome.reason,
      entities: dedupe([...seed.entities, ...(outcome.actor ? [countryRef(outcome.actor)] : []), target]),
      // Big only when it really landed hard, so the director spaces the next big story after it.
      tags: uniqueTags([DEVELOPMENT_TAG, TONE_TAGS[tone], ...(Math.abs(weight) > SCALE_LIMITS.minor.maxWeight ? [MAJOR_TAG] : []), ...seed.tags]),
      causeId: seed.originEventId,
      seedId: seed.id,
      ...(move ? { effectId: move } : outcome.impacts.length > 0 ? { effectId: 'improvised' as const } : {})
    })
    if (move) addEffect({ effectId: move, actor, target, source, originEventId: event.id, seed, ...(outcome.title ? { label: outcome.title } : {}) })
    if (outcome.impacts.length > 0) {
      addEffect({
        effectId: 'improvised',
        actor,
        target,
        source,
        originEventId: event.id,
        seed,
        label: title,
        modifiers: improvised(outcome.impacts, target, actor),
        durationTurns: LASTS_TURNS[outcome.lasts]
      })
    }
    if (move || outcome.impacts.length > 0) {
      firedSeeds.push({ seedId: seed.id, plantedTurn: seed.plantedTurn, effectId: move ?? 'improvised', source: seed.sourceEffectId, origin })
    }
    seedUpdates.push({ ...seed, status: 'fired', firedTurn: next.turn })
  }
  for (const seed of plan.fizzled) {
    record({
      kind: 'seed_fizzled',
      visibility: 'hidden',
      title: 'Tohum söndü',
      summary: seed.hook,
      entities: seed.entities,
      tags: seed.tags,
      causeId: seed.originEventId,
      seedId: seed.id
    })
    seedUpdates.push({ ...seed, status: 'defused', firedTurn: null })
  }

  for (const proposal of changes.newSeeds) {
    const [min, max] = DORMANCY_TURNS[proposal.dormancy]
    const id = formatId('sd', next.counters.seed++)
    const tags = uniqueTags(proposal.tags)
    record({
      kind: 'seed_planted',
      visibility: 'hidden',
      title: 'Tohum ekildi',
      summary: proposal.hook,
      entities: dedupe(proposal.entities),
      tags,
      causeId: order?.id ?? null,
      seedId: id
    })
    seeds.push({
      id,
      plantedTurn: next.turn,
      wakeTurn: next.turn + rng.int(min, max),
      originEventId: order?.id ?? events[0]?.id ?? id,
      sourceEffectId: proposal.source,
      hook: proposal.hook,
      entities: dedupe(proposal.entities),
      tags,
      likelihood: proposal.likelihood,
      condition: proposal.condition,
      status: 'dormant',
      firedTurn: null
    })
  }

  // Every bar moves: effects first, then the natural drift.
  const causes = tickBars(next, startBars, rng)

  // Effects that have run their course.
  const expired: string[] = []
  next.effects = next.effects.filter((e) => {
    if (e.expiresTurn === null || next.turn + 1 < e.expiresTurn) return true
    const touchesPlayer = e.actor === player || e.modifiers.some((m) => m.country === player)
    // One-turn effects (a protest note) start and end in the same turn; no need to announce the end.
    if (touchesPlayer && e.appliedTurn < next.turn) {
      const other = e.actor !== player ? countryRef(e.actor) : owningCountry(next, e.target) !== player ? e.target : null
      const name = e.label ?? EFFECTS[e.effectId].label
      const label = other && !e.label ? `${name}: ${entityName(next, other)}` : name
      expired.push(label)
      record({
        kind: 'effect_expired',
        visibility: 'public',
        title: `Sona erdi: ${label}`,
        summary: '',
        entities: [countryRef(player)],
        tags: uniqueTags(EFFECTS[e.effectId].tags),
        causeId: e.originEventId
      })
    }
    return false
  })

  const me = findCountry(next, player)
  if (!me) throw new Error(`player country ${player} missing`)
  const bump = (bar: 'approval' | 'stability', delta: number, label: string): void => {
    me.bars[bar] = clamp(me.bars[bar] + delta)
    const perBar = causes.get(player) ?? new Map()
    causes.set(player, perBar)
    perBar.set(bar, [...(perBar.get(bar) ?? []), { label, delta, kind: 'event' }])
  }

  // Election day.
  let election: TurnReport['election'] = null
  if (next.turn >= next.election.nextTurn) {
    const vote = clamp(me.bars.approval + rng.int(-ELECTION_LUCK, ELECTION_LUCK))
    const won = vote >= next.election.threshold
    election = { vote, threshold: next.election.threshold, won }
    next.election.last = { turn: next.turn, vote, won }
    record({
      kind: 'election',
      visibility: 'public',
      title: won ? `Seçim kazanıldı: oyların %${ek(vote, 'i')}` : `Seçim kaybedildi: oyların %${ek(vote, 'i')}`,
      summary: won
        ? `Halk bir dönem daha güven verdi. Bir sonraki seçim ${next.election.everyTurns} tur sonra.`
        : `Gereken %${next.election.threshold} barajına ulaşılamadı. İktidar el değiştiriyor.`,
      entities: [countryRef(player)],
      tags: ['secim'],
      causeId: null
    })
    if (won) {
      next.election.nextTurn = next.turn + next.election.everyTurns
      next.election.won += 1
      me.nextElection = addMonths(next.date, next.election.everyTurns * MONTHS_PER_TURN)
      bump('approval', ELECTION_WIN_BONUS, 'Seçim zaferi')
    } else {
      next.status = 'lost'
      next.ending = {
        kind: 'election_lost',
        turn: next.turn,
        title: 'Seçimi kaybettin',
        detail: `Sandıktan %${vote} çıktı; baraj %${next.election.threshold} idi.`
      }
    }
  }

  // The army watches stability.
  let coup: TurnReport['coup'] = null
  const chance = coupChance(me.bars.stability)
  if (next.status === 'playing' && chance > 0) {
    const happened = rng.next() < chance
    coup = { chance, happened }
    if (happened) {
      next.status = 'lost'
      next.ending = {
        kind: 'coup',
        turn: next.turn,
        title: 'Darbe',
        detail: `İstikrar ${ek(me.bars.stability, 'e')} düştü ve ordu yönetime el koydu.`
      }
      record({
        kind: 'coup',
        visibility: 'public',
        title: 'Ordu yönetime el koydu',
        summary: 'Gece yarısı tanklar sokağa çıktı. Hükümet düşürüldü.',
        entities: [countryRef(player)],
        tags: ['darbe'],
        causeId: null
      })
    } else {
      record({
        kind: 'warning',
        visibility: 'public',
        title: `Kışlalarda huzursuzluk (darbe riski %${Math.round(chance * 100)})`,
        summary: 'İstikrar tehlikeli seviyede. Ordu içinde sesler yükseliyor.',
        entities: [countryRef(player)],
        tags: ['darbe-riski'],
        causeId: null
      })
    }
  }

  next.politicalCapital.current = next.politicalCapital.perTurn

  record({
    kind: 'narration',
    visibility: 'public',
    title: changes.narration.headline,
    summary: changes.narration.body,
    entities: [countryRef(player)],
    tags: [],
    causeId: order?.id ?? null
  })

  const before = startBars.get(player) ?? me.bars
  const bars: BarChange[] = BAR_IDS.map((bar) => ({
    bar,
    before: before[bar],
    after: me.bars[bar],
    causes: causes.get(player)?.get(bar) ?? []
  }))
  const report: TurnReport = {
    turn: next.turn,
    date: next.date,
    bars,
    capital: { spent, next: next.politicalCapital.current },
    firedSeeds,
    expired,
    election,
    coup
  }
  next.lastReport = report
  next.rng = rng.state

  return { newState: next, events, seeds, seedUpdates, narration: changes.narration, report }
}

/** Where a seed came from, in words: the player's decision, or the world. */
export function seedOrigin(seed: Seed): string {
  return seed.sourceEffectId ? EFFECTS[seed.sourceEffectId].label : 'Dünya gündemi'
}

function dedupe(refs: readonly EntityRef[]): EntityRef[] {
  const seen = new Set<string>()
  return refs.filter((r) => {
    const key = entityKey(r)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
