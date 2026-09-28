import { useState } from 'react'
import type { ActiveEffectView, BarView, GameView } from '@shared/game/view'
import { lineTone, percent, prettyLine, signed } from '../lib/format'

const CORE = ['approval', 'stability', 'economy', 'welfare'] as const
const POWER = ['military', 'sovereignty', 'reputation'] as const

export function NationPanel({ view, onFold }: { view: GameView; onFold?: () => void }): React.JSX.Element {
  const { player } = view
  const byId = new Map(player.bars.map((b) => [b.id, b]))
  const approval = byId.get('approval')

  return (
    <section className="nation hud-panel" aria-label={player.name}>
      <header className="nation__head">
        <div>
          <span className="eyebrow">Hükümet</span>
          <h1 className="nation__name">{player.name}</h1>
        </div>
        <Capital left={player.capital.left} max={player.capital.max} />
        {onFold && (
          <button type="button" className="fold fold--left" onClick={onFold} aria-label="Paneli katla" title="Paneli katla">
            ‹
          </button>
        )}
      </header>

      {approval && <ElectionCard view={view} approval={approval.value} />}

      {player.coupRisk > 0 && view.status === 'playing' && (
        <div className="alarm" role="alert">
          <strong>Darbe riski {percent(player.coupRisk)}</strong>
          <span>İstikrar tehlikeli seviyede. Ordu her ay yeniden karar veriyor.</span>
        </div>
      )}

      <div className="bars">
        {CORE.map((id) => byId.get(id)).map((b) => b && <Bar key={b.id} bar={b} threshold={b.id === 'approval' ? player.election.threshold : undefined} />)}
        <div className="bars__rule" />
        {POWER.map((id) => byId.get(id)).map((b) => b && <Bar key={b.id} bar={b} small />)}
      </div>

      <Effects effects={view.effects} />
    </section>
  )
}

function Capital({ left, max }: { left: number; max: number }): React.JSX.Element {
  return (
    <div className="capital" title="Siyasi sermaye: her karar 1 puan. Her ay yenilenir. Konuşmak bedava.">
      <span className="capital__pips" aria-hidden="true">
        {Array.from({ length: max }, (_, i) => (
          <span key={i} className={`pip${i < left ? ' pip--on' : ''}`} />
        ))}
      </span>
      <span className="capital__label">
        {left}/{max} sermaye
      </span>
    </div>
  )
}

function ElectionCard({ view, approval }: { view: GameView; approval: number }): React.JSX.Element {
  const { election } = view.player
  const margin = approval - election.threshold
  const tone = margin >= 5 ? 'safe' : margin >= 0 ? 'close' : 'behind'
  return (
    <div className={`election election--${tone}`}>
      <div className="election__numbers">
        <div>
          <span className="eyebrow">Anket</span>
          <div className="election__poll">
            %{approval}
            <span className="election__margin">{margin >= 0 ? `barajın ${margin} puan üstü` : `barajın ${-margin} puan altı`}</span>
          </div>
        </div>
        <div className="election__when">
          <span className="eyebrow">Seçim</span>
          <div className="election__count">{election.turnsLeft === 0 ? 'bu ay' : `${election.turnsLeft} ay`}</div>
          <span className="election__meta">
            baraj %{election.threshold}
            {election.won > 0 ? ` · ${election.won} zafer` : ''}
          </span>
        </div>
      </div>
      <PollChart polls={view.polls} threshold={election.threshold} electionTurn={view.turn + election.turnsLeft} />
    </div>
  )
}

function PollChart({
  polls,
  threshold,
  electionTurn
}: {
  polls: GameView['polls']
  threshold: number
  electionTurn: number
}): React.JSX.Element {
  const w = 300
  const h = 64
  const values = polls.map((p) => p.approval)
  const lo = Math.min(threshold - 12, ...values) - 2
  const hi = Math.max(threshold + 12, ...values) + 2
  const first = polls[0]?.turn ?? 0
  const last = Math.max(electionTurn, polls.at(-1)?.turn ?? 0, first + 1)
  const x = (turn: number): number => ((turn - first) / (last - first)) * (w - 8) + 4
  const y = (v: number): number => h - 4 - ((v - lo) / (hi - lo)) * (h - 8)
  const path = polls.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.turn).toFixed(1)},${y(p.approval).toFixed(1)}`).join('')
  const end = polls.at(-1)

  return (
    <svg className="poll" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Anket geçmişi">
      <line className="poll__threshold" x1={0} x2={w} y1={y(threshold)} y2={y(threshold)} />
      <line className="poll__election" x1={x(electionTurn)} x2={x(electionTurn)} y1={2} y2={h - 2} />
      {path && <path className="poll__line" d={path} />}
      {end && <circle className="poll__dot" cx={x(end.turn)} cy={y(end.approval)} r={3} />}
    </svg>
  )
}

function Bar({ bar, threshold, small }: { bar: BarView; threshold?: number; small?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const low = bar.value < 35
  return (
    <div className={`bar${small ? ' bar--small' : ''}${low ? ' bar--low' : ''}`}>
      <button type="button" className="bar__row" onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={bar.causes.length === 0}>
        <span className="bar__label">{bar.label}</span>
        <span className="bar__value">{bar.value}</span>
        <Delta n={bar.delta} />
      </button>
      <div className="bar__track" aria-hidden="true">
        <span className="bar__fill" style={{ width: `${bar.value}%` }} />
        {threshold !== undefined && <span className="bar__mark" style={{ left: `${threshold}%` }} />}
      </div>
      {open && (
        <ul className="causes">
          {bar.causes.map((c, i) => (
            <li key={i} className={`causes__item causes__item--${c.kind}`}>
              <span>{c.label}</span>
              <span className={c.delta > 0 ? 'up' : 'down'}>{signed(c.delta)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Delta({ n }: { n: number }): React.JSX.Element {
  if (n === 0) return <span className="delta delta--zero">·</span>
  return <span className={`delta ${n > 0 ? 'delta--up' : 'delta--down'}`}>{signed(n)}</span>
}

function Effects({ effects }: { effects: ActiveEffectView[] }): React.JSX.Element {
  return (
    <div className="effects">
      <div className="section-head">
        <span className="eyebrow">Yürürlükte</span>
        <span className="section-head__meta">{effects.length}</span>
      </div>
      {effects.length === 0 ? (
        <p className="quiet">Şu an süren bir etki yok.</p>
      ) : (
        <ul className="effects__list">
          {effects.map((e) => (
            <li key={e.id} className="effect">
              <div className="effect__head">
                <span className="effect__label">{e.label}</span>
                <span className="effect__left">{e.turnsLeft === null ? 'kalıcı' : e.turnsLeft === 0 ? 'son ay' : `${e.turnsLeft} ay daha`}</span>
              </div>
              <div className="effect__meta">
                <span className="effect__source">{e.source}</span>
                {e.lines.map((l) => (
                  <span key={l} className={`chip chip--${lineTone(l)}`}>
                    {prettyLine(l)}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
