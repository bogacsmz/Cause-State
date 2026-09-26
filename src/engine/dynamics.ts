import { EFFECTS } from '@shared/game/catalog'
import { BAR_IDS, countryRef, type BarId, type Bars } from '@shared/game/primitives'
import type { ActiveEffect, BarCause, Country, GameState } from '@shared/game/schema'
import { entityName } from './lookup'
import type { Rng } from './rng'

// How the world moves on its own each turn. Every number that shapes the game's feel
// lives here, in one place, so balancing means editing this table.

export const DYNAMICS = {
  /** Approval target = weighted welfare/economy/stability, minus government fatigue. */
  approvalWeights: { welfare: 0.4, economy: 0.3, stability: 0.3 },
  /** Fatigue at the start, and extra fatigue for every full year in power. */
  fatigueBase: 2,
  fatiguePerYear: 2,
  /** Stability target = weighted approval/welfare/military. */
  stabilityWeights: { approval: 0.5, welfare: 0.4, military: 0.1 },
  /** Slow bars move this many points per turn toward their target (double when far away). */
  step: 1,
  fastStep: 2,
  fastGap: 8,
  /** Approval, stability and welfare close this share of the gap to their target every turn (at least 1). */
  pull: 0.2,
  /** Slow bars don't move while within this distance of their anchor. */
  anchorDeadZone: 2,
  /** The economy returns to its long-run level once it is further than this from it. */
  economyDeadZone: 4,
  /** Chance that the economy wobbles by one point in a turn. */
  noiseChance: 0.5,
  /** Below this stability the army starts to think about a coup. */
  coupThreshold: 40,
  /** Coup chance per point of stability below the threshold (capped). */
  coupChancePerPoint: 0.05,
  coupChanceMax: 0.9
} as const

export function approvalTarget(bars: Bars, turn: number): number {
  const w = DYNAMICS.approvalWeights
  const years = Math.floor(Math.max(0, turn - 1) / 12)
  const fatigue = DYNAMICS.fatigueBase + DYNAMICS.fatiguePerYear * years
  return Math.round(w.welfare * bars.welfare + w.economy * bars.economy + w.stability * bars.stability) - fatigue
}

export function stabilityTarget(bars: Bars): number {
  const w = DYNAMICS.stabilityWeights
  return Math.round(w.approval * bars.approval + w.welfare * bars.welfare + w.military * bars.military)
}

/** Chance of a coup this turn at a given stability. */
export function coupChance(stability: number): number {
  if (stability >= DYNAMICS.coupThreshold) return 0
  return Math.min(DYNAMICS.coupChanceMax, (DYNAMICS.coupThreshold - stability) * DYNAMICS.coupChancePerPoint)
}

export type BarCauses = Map<string, Map<BarId, BarCause[]>>

/**
 * Moves every country's bars one turn: first active effects, then the natural drift
 * (computed from where the bars stood at the start of the turn). Returns why each bar
 * moved, so the player can see cause and effect.
 */
export function tickBars(next: GameState, startBars: ReadonlyMap<string, Bars>, rng: Rng): BarCauses {
  const causes: BarCauses = new Map()
  const add = (country: string, bar: BarId, cause: BarCause): void => {
    if (cause.delta === 0) return
    let perBar = causes.get(country)
    if (!perBar) causes.set(country, (perBar = new Map()))
    perBar.set(bar, [...(perBar.get(bar) ?? []), cause])
  }

  for (const effect of next.effects) {
    const active = effect.expiresTurn === null || next.turn < effect.expiresTurn
    if (!active) continue
    for (const m of effect.modifiers) {
      if (m.mode === 'once' && effect.appliedTurn !== next.turn) continue
      add(m.country, m.bar, {
        label: causeLabel(next, effect, m.country),
        delta: m.delta,
        kind: 'effect',
        effectId: effect.effectId,
        ...(effect.seedId ? { seedId: effect.seedId } : {})
      })
    }
  }

  for (const country of next.countries) {
    const perBar = causes.get(country.id)
    for (const bar of BAR_IDS) {
      const sum = (perBar?.get(bar) ?? []).reduce((n, c) => n + c.delta, 0)
      country.bars[bar] = clamp(country.bars[bar] + sum)
    }
    drift(country, startBars.get(country.id) ?? country.bars, next.turn, rng, (bar, cause) => add(country.id, bar, cause))
  }
  return causes
}

/**
 * Names an effect from the affected country's side: "Yaptırım · Yunanistan" when Greece did
 * it, "Yaptırım → Yunanistan" when it was aimed at Greece, just "Yaptırım" when it is home-grown.
 */
function causeLabel(state: GameState, effect: ActiveEffect, affected: string): string {
  const label = EFFECTS[effect.effectId].label
  if (effect.actor !== affected) return `${label} · ${entityName(state, countryRef(effect.actor))}`
  const aimedAt = effect.target.type === 'province' || effect.target.id !== affected ? effect.target : null
  return aimedAt ? `${label} → ${entityName(state, aimedAt)}` : label
}

function drift(country: Country, start: Bars, turn: number, rng: Rng, add: (bar: BarId, cause: BarCause) => void): void {
  const move = (bar: BarId, target: number, deadZone: number, label: string, proportional = false): void => {
    const delta = proportional ? pullToward(country.bars[bar], target) : stepToward(country.bars[bar], target, deadZone)
    if (delta === 0) return
    country.bars[bar] = clamp(country.bars[bar] + delta)
    add(bar, { label, delta, kind: 'drift' })
  }

  move('approval', approvalTarget(start, turn), 0, 'Halkın genel memnuniyeti', true)
  move('stability', stabilityTarget(start), 0, 'Toplumsal denge', true)
  move('welfare', start.economy, 0, 'Ekonominin hayata yansıması', true)
  move('economy', country.anchors.economy, DYNAMICS.economyDeadZone, 'Ekonominin olağan seyri')
  for (const bar of ['sovereignty', 'military', 'reputation'] as const) {
    move(bar, country.anchors[bar], DYNAMICS.anchorDeadZone, 'Olağan seyir')
  }

  if (rng.next() < DYNAMICS.noiseChance) {
    const delta = rng.next() < 0.5 ? -1 : 1
    country.bars.economy = clamp(country.bars.economy + delta)
    add('economy', { label: 'Piyasa dalgalanması', delta, kind: 'noise' })
  }
}

/** Moves a share of the gap: a one-off boost fades within a few turns, a big gap closes fast. */
function pullToward(value: number, target: number): number {
  const gap = target - value
  if (gap === 0) return 0
  return Math.sign(gap) * Math.max(1, Math.round(Math.abs(gap) * DYNAMICS.pull))
}

function stepToward(value: number, target: number, deadZone: number): number {
  const gap = target - value
  if (Math.abs(gap) <= deadZone) return 0
  const size = Math.abs(gap) >= DYNAMICS.fastGap ? DYNAMICS.fastStep : DYNAMICS.step
  return Math.sign(gap) * Math.min(size, Math.abs(gap))
}

export function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}
