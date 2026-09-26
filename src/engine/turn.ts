import { EFFECTS, type EffectId } from '@shared/game/catalog'
import type { TurnAction, TurnOutcome } from '@shared/game/contract'
import { BAR_IDS, countryRef, entityKey, type Bars, type EntityRef } from '@shared/game/primitives'
import type { ActiveEffect, BarChange, GameEvent, GameState, Seed, TurnReport } from '@shared/game/schema'
import { clamp, coupChance, tickBars } from './dynamics'
import { entityName, findCountry, owningCountry } from './lookup'
import { createRng } from './rng'
import { DORMANCY_TURNS } from './seeds'
import { addMonths, formatId, truncate, uniqueTags } from './util'

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
  const applyEffect = (a: {
    effectId: EffectId
    actor: string
    target: EntityRef
    source: ActiveEffect['source']
    reason: string
    causeId: string | null
    seed?: Seed
  }): void => {
    const def = EFFECTS[a.effectId]
    const targetCountry = owningCountry(next, a.target) ?? a.actor
    const modifiers = def.modifiers.map((m) => ({
      country: m.on === 'actor' ? a.actor : targetCountry,
      bar: m.bar,
      delta: m.delta,
      mode: m.mode
    }))
    const event = record({
      kind: a.seed ? 'seed_fired' : a.source === 'player' ? 'effect_applied' : 'foreign_action',
      visibility: 'public',
      title: truncate(
        a.seed
          ? `${a.seed.sourceEffectId ? 'Kelebek etkisi' : 'Dünya gündemi'}: ${def.label}`
          : `${def.label}: ${entityName(next, a.target)}`,
        160
      ),
      summary: a.reason,
      entities: dedupe([countryRef(a.actor), a.target, ...modifiers.map((m) => countryRef(m.country))]),
      tags: uniqueTags(def.tags),
      causeId: a.causeId,
      effectId: a.effectId,
      ...(a.seed ? { seedId: a.seed.id } : {})
    })
    next.effects.push({
      id: formatId('fx', next.counters.effect++),
      effectId: a.effectId,
      actor: a.actor,
      target: a.target,
      source: a.source,
      seedId: a.seed?.id ?? null,
      appliedTurn: next.turn,
      expiresTurn: def.durationTurns === null ? null : next.turn + def.durationTurns,
      modifiers,
      originEventId: event.id
    })
    if (a.source === 'player') spent += def.cost
  }

  for (const c of changes.changes) {
    applyEffect({ effectId: c.effectId, actor: player, target: c.target, source: 'player', reason: c.reason, causeId: order?.id ?? null })
  }
  for (const f of changes.foreignIntents) {
    applyEffect({ effectId: f.effectId, actor: f.actor, target: f.target, source: 'foreign', reason: f.reason, causeId: order?.id ?? null })
  }

  // Fired seeds: the code chose the moment, the (fake or real) AI chose the outcome.
  const firedSeeds: TurnReport['firedSeeds'] = []
  for (const seed of plan.firing) {
    const outcome = changes.seedOutcomes.find((o) => o.seedId === seed.id)
    if (!outcome) throw new Error(`firing seed ${seed.id} has no outcome; the referee should have caught this`)
    const origin = seedOrigin(seed)
    if (outcome.effectId && outcome.target) {
      const actor = outcome.actor ?? owningCountry(next, outcome.target) ?? player
      applyEffect({
        effectId: outcome.effectId,
        actor,
        target: outcome.target,
        source: outcome.actor ? 'foreign' : 'world',
        reason: outcome.reason,
        causeId: seed.originEventId,
        seed
      })
      firedSeeds.push({ seedId: seed.id, plantedTurn: seed.plantedTurn, effectId: outcome.effectId, source: seed.sourceEffectId, origin })
    } else {
      record({
        kind: 'seed_fired',
        visibility: 'public',
        title: seed.sourceEffectId ? 'Kelebek etkisi' : 'Dünya gündemi',
        summary: outcome.reason,
        entities: seed.entities,
        tags: seed.tags,
        causeId: seed.originEventId,
        seedId: seed.id
      })
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
    if (touchesPlayer) {
      const label = EFFECTS[e.effectId].label
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
      title: won ? `Seçim kazanıldı: oyların %${vote}'i` : `Seçim kaybedildi: oyların %${vote}'i`,
      summary: won
        ? `Halk bir dönem daha güven verdi. Bir sonraki seçim ${next.election.everyTurns} tur sonra.`
        : `Gereken %${next.election.threshold} barajına ulaşılamadı. İktidar el değiştiriyor.`,
      entities: [countryRef(player)],
      tags: ['secim'],
      causeId: null
    })
    if (won) {
      next.election.nextTurn = next.turn + next.election.everyTurns
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
        detail: `İstikrar ${me.bars.stability}'e düştü ve ordu yönetime el koydu.`
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
