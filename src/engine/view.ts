import { EFFECTS, PLAYER_EFFECT_IDS, type EffectDef } from '@shared/game/catalog'
import { BAR_LABELS, countryRef, type EntityRef } from '@shared/game/primitives'
import type { GameEvent, GameState, Seed } from '@shared/game/schema'
import type { ActiveEffectView, DecisionOption, DecisionTarget, FeedEvent, GameView } from '@shared/game/view'
import { coupChance } from './dynamics'
import { findCountry } from './lookup'
import { checkDecision, explainIssue } from './referee'
import { seedOrigin } from './turn'

/** Human lines for an effect's numbers, e.g. "Onay +5", "Ekonomi +2/tur", "4 tur". */
export function effectLines(def: EffectDef): string[] {
  const bilateral = def.rules.some((r) => r.kind === 'target_not_actor')
  const lines = def.modifiers.map(
    (m) =>
      `${bilateral && m.on === 'target' ? 'Hedef: ' : ''}${BAR_LABELS[m.bar]} ${m.delta > 0 ? '+' : ''}${m.delta}${m.mode === 'per_turn' ? '/tur' : ''}`
  )
  lines.push(def.durationTurns === null ? 'kalıcı' : `${def.durationTurns} tur`)
  return lines
}

export function decisionOptions(state: GameState): DecisionOption[] {
  const player = state.playerCountryId
  return PLAYER_EFFECT_IDS.map((id) => {
    const def = EFFECTS[id]
    const bilateral = def.rules.some((r) => r.kind === 'target_not_actor')
    const candidates: EntityRef[] =
      def.target === 'province'
        ? state.provinces.filter((p) => p.owner === player).map((p) => ({ type: 'province', id: p.id }))
        : bilateral
          ? state.countries.filter((c) => c.id !== player).map((c) => countryRef(c.id))
          : [countryRef(player)]

    const targets: DecisionTarget[] = candidates.map((ref) => {
      const issues = checkDecision(state, id, ref)
      const name =
        ref.type === 'country'
          ? (findCountry(state, ref.id)?.name ?? ref.id)
          : (state.provinces.find((p) => p.id === ref.id)?.name ?? ref.id)
      return issues.length === 0 ? { ref, name, available: true } : { ref, name, available: false, reason: explainIssue(issues[0]!) }
    })
    const available = targets.some((t) => t.available) && def.cost <= state.politicalCapital.current
    const reason =
      def.cost > state.politicalCapital.current
        ? 'Bu tur için siyasi sermaye yetmiyor.'
        : targets.length === 1 && !targets[0]!.available
          ? targets[0]!.reason
          : undefined

    return {
      effectId: id,
      label: def.label,
      summary: def.summary,
      category: def.category,
      cost: def.cost,
      targetKind: def.target === 'province' ? 'province' : bilateral ? 'country' : 'self',
      targets,
      available,
      ...(reason ? { reason } : {}),
      lines: effectLines(def)
    }
  })
}

export interface ViewInput {
  state: GameState
  /** Public events for the feed, oldest first. */
  feed: readonly GameEvent[]
  /** Seeds referenced by fired-seed events in the feed, to show where they came from. */
  seeds: readonly Seed[]
}

export function buildView({ state, feed, seeds }: ViewInput): GameView {
  const player = state.playerCountryId
  const me = findCountry(state, player)
  if (!me) throw new Error(`player country ${player} missing`)
  const seedById = new Map(seeds.map((s) => [s.id, s]))

  const effects: ActiveEffectView[] = state.effects
    .filter((e) => e.actor === player || e.modifiers.some((m) => m.country === player))
    .map((e) => {
      const def = EFFECTS[e.effectId]
      const lines = e.modifiers
        .filter((m) => m.country === player)
        .map((m) => `${BAR_LABELS[m.bar]} ${m.delta > 0 ? '+' : ''}${m.delta}${m.mode === 'per_turn' ? '/tur' : ''}`)
      return {
        id: e.id,
        effectId: e.effectId,
        label: def.label,
        source: e.source === 'player' ? 'Senin kararın' : e.source === 'world' ? 'Toplum ve piyasalar' : (findCountry(state, e.actor)?.name ?? e.actor),
        turnsLeft: e.expiresTurn === null ? null : Math.max(0, e.expiresTurn - state.turn - 1),
        lines,
        fromSeed: e.seedId !== null
      }
    })

  const feedView: FeedEvent[] = feed.map((e) => {
    const seed = e.kind === 'seed_fired' && e.seedId ? seedById.get(e.seedId) : undefined
    return {
      id: e.id,
      turn: e.turn,
      date: e.date,
      kind: e.kind,
      title: e.title,
      summary: e.summary,
      ...(seed
        ? { origin: { turn: seed.plantedTurn, label: seedOrigin(seed), butterfly: seed.sourceEffectId !== null } }
        : {})
    }
  })

  return {
    gameId: state.gameId,
    turn: state.turn,
    date: state.date,
    status: state.status,
    ending: state.ending,
    player: {
      id: me.id,
      name: me.name,
      bars: { ...me.bars },
      capital: { current: state.politicalCapital.current, max: state.politicalCapital.max },
      election: {
        turnsLeft: Math.max(0, state.election.nextTurn - state.turn),
        threshold: state.election.threshold,
        nextDate: me.nextElection,
        last: state.election.last
      },
      coupRisk: coupChance(me.bars.stability)
    },
    options: decisionOptions(state),
    effects,
    report: state.lastReport,
    feed: feedView
  }
}
