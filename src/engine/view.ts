import { CATEGORY_LABELS, EFFECTS, PLAYER_EFFECT_IDS, type EffectDef } from '@shared/game/catalog'
import { BAR_IDS, BAR_LABELS, countryRef, type EntityRef } from '@shared/game/primitives'
import type { GameEvent, GameState, Seed } from '@shared/game/schema'
import type {
  ActiveEffectView,
  BarView,
  ChatEntry,
  DecisionOption,
  DecisionTarget,
  FeedEvent,
  GameView,
  PendingView
} from '@shared/game/view'
import { coupChance } from './dynamics'
import { entityName, findCountry } from './lookup'
import { checkDecision, explainIssue } from './referee'
import type { Decision } from './scripted-ai'
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

/** Every card the player could play, checked against the state and what is already picked this turn. */
export function decisionOptions(state: GameState, pending: readonly Decision[] = []): DecisionOption[] {
  const player = state.playerCountryId
  const left = state.politicalCapital.current - pending.reduce((n, d) => n + EFFECTS[d.effectId].cost, 0)
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
      const issues = checkDecision(state, id, ref, pending)
      const name = entityName(state, ref)
      return issues.length === 0 ? { ref, name, available: true } : { ref, name, available: false, reason: explainIssue(issues[0]!) }
    })
    const available = targets.some((t) => t.available)
    const reason = available
      ? undefined
      : def.cost > left
        ? 'Bu tur için siyasi sermaye yetmiyor.'
        : (targets[0]?.reason ?? 'Şu an yapılamaz.')

    return {
      effectId: id,
      label: def.label,
      summary: def.summary,
      category: def.category,
      categoryLabel: CATEGORY_LABELS[def.category],
      cost: def.cost,
      targetKind: def.target === 'province' ? 'province' : bilateral ? 'country' : 'self',
      targets,
      available,
      ...(reason ? { reason } : {}),
      picked: pending.some((d) => d.effectId === id),
      lines: effectLines(def)
    }
  })
}

export interface PendingDecision {
  id: string
  decision: Decision
  order: string | null
}

export interface ViewInput {
  state: GameState
  /** Public events for the feed, oldest first. */
  feed: readonly GameEvent[]
  /** Seeds referenced by fired-seed events in the feed, to show where they came from. */
  seeds: readonly Seed[]
  pending?: readonly PendingDecision[]
  chat?: readonly ChatEntry[]
  polls?: GameView['polls']
}

export function buildView({ state, feed, seeds, pending = [], chat = [], polls = [] }: ViewInput): GameView {
  const player = state.playerCountryId
  const me = findCountry(state, player)
  if (!me) throw new Error(`player country ${player} missing`)
  const seedById = new Map(seeds.map((s) => [s.id, s]))

  const report = state.lastReport
  const bars: BarView[] = BAR_IDS.map((id) => {
    const change = report?.bars.find((b) => b.bar === id)
    return {
      id,
      label: BAR_LABELS[id],
      value: me.bars[id],
      delta: change ? change.after - change.before : 0,
      causes: change?.causes ?? []
    }
  })

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
        label: e.target.id === player ? def.label : `${def.label}: ${entityName(state, e.target)}`,
        source:
          e.source === 'player'
            ? 'Senin kararın'
            : e.source === 'world'
              ? 'Toplum ve piyasalar'
              : (findCountry(state, e.actor)?.name ?? e.actor),
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
      ...(seed ? { origin: { turn: seed.plantedTurn, label: seedOrigin(seed), butterfly: seed.sourceEffectId !== null } } : {})
    }
  })

  const pendingView: PendingView[] = pending.map((p) => {
    const def = EFFECTS[p.decision.effectId]
    return {
      id: p.id,
      effectId: p.decision.effectId,
      label: def.label,
      targetName: p.decision.target.id === player ? '' : entityName(state, p.decision.target),
      cost: def.cost,
      order: p.order
    }
  })
  const spent = pendingView.reduce((n, p) => n + p.cost, 0)

  return {
    gameId: state.gameId,
    turn: state.turn,
    date: state.date,
    status: state.status,
    ending: state.ending,
    player: {
      id: me.id,
      name: me.name,
      bars,
      capital: { current: state.politicalCapital.current, max: state.politicalCapital.max, left: state.politicalCapital.current - spent },
      election: {
        turnsLeft: Math.max(0, state.election.nextTurn - state.turn),
        threshold: state.election.threshold,
        nextDate: me.nextElection,
        last: state.election.last,
        won: state.election.won
      },
      coupRisk: coupChance(me.bars.stability)
    },
    options: decisionOptions(state, pending.map((p) => p.decision)),
    pending: pendingView,
    effects,
    report,
    feed: feedView,
    chat: [...chat],
    polls: [...polls]
  }
}
