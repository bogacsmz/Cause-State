import { useMemo, useState } from 'react'
import type { EffectCategory } from '@shared/game/catalog'
import type { EntityRef } from '@shared/game/primitives'
import type { DecisionOption, GameView } from '@shared/game/view'
import { lineTone, prettyLine } from '../lib/format'

interface Props {
  view: GameView
  busy: boolean
  onPick: (option: DecisionOption, target: EntityRef) => void
}

export function DecisionDeck({ view, busy, onPick }: Props): React.JSX.Element {
  const categories = useMemo(() => {
    const seen = new Map<EffectCategory, string>()
    for (const o of view.options) if (!seen.has(o.category)) seen.set(o.category, o.categoryLabel)
    return [...seen]
  }, [view.options])
  const [tab, setTab] = useState<EffectCategory | 'all'>('all')
  const shown = view.options.filter((o) => tab === 'all' || o.category === tab)
  const playing = view.status === 'playing'

  return (
    <section className="deck" aria-label="Kararlar">
      <div className="deck__head">
        <div className="section-head">
          <span className="eyebrow">Kararlar</span>
          <span className="section-head__meta">her biri 1 sermaye · nota bedava</span>
        </div>
        <div className="tabs" role="tablist">
          <Tab active={tab === 'all'} onClick={() => setTab('all')}>
            Tümü
          </Tab>
          {categories.map(([id, label]) => (
            <Tab key={id} active={tab === id} onClick={() => setTab(id)}>
              {label}
            </Tab>
          ))}
        </div>
      </div>

      <div className="deck__grid">
        {shown.map((o) => (
          <Card key={o.effectId} option={o} disabled={busy || !playing} onPick={onPick} />
        ))}
      </div>
    </section>
  )
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <button type="button" role="tab" aria-selected={active} className={`tab${active ? ' tab--on' : ''}`} onClick={onClick}>
      {children}
    </button>
  )
}

function Card({ option: o, disabled, onPick }: { option: DecisionOption; disabled: boolean; onPick: Props['onPick'] }): React.JSX.Element {
  const open = o.targets.filter((t) => t.available)
  const [choice, setChoice] = useState<string>('')
  const target = open.find((t) => t.ref.id === choice) ?? (o.targetKind === 'self' ? open[0] : undefined)
  const state = o.picked ? 'picked' : o.available ? 'open' : 'closed'

  return (
    <article className={`card card--${state}`}>
      <header className="card__head">
        <h3 className="card__title">{o.label}</h3>
        <span className={`cost${o.cost === 0 ? ' cost--free' : ''}`}>{o.cost === 0 ? 'bedava' : `${o.cost} sermaye`}</span>
      </header>
      <p className="card__summary">{o.summary}</p>
      <div className="card__lines">
        {o.lines.map((l) => (
          <span key={l} className={`chip chip--${lineTone(l)}`}>
            {prettyLine(l)}
          </span>
        ))}
      </div>

      <footer className="card__foot">
        {o.picked && !o.available ? (
          <span className="card__note card__note--picked">Bu tur seçildi</span>
        ) : !o.available ? (
          <span className="card__note">{o.reason}</span>
        ) : (
          <>
            {o.targetKind !== 'self' && (
              <select
                className="card__target"
                value={target?.ref.id ?? ''}
                onChange={(e) => setChoice(e.target.value)}
                disabled={disabled}
                aria-label={`${o.label} hedefi`}
              >
                <option value="" disabled>
                  {o.targetKind === 'province' ? 'İl seç' : 'Ülke seç'}
                </option>
                {o.targets.map((t) => (
                  <option key={t.ref.id} value={t.ref.id} disabled={!t.available} title={t.reason}>
                    {t.name}
                    {t.available ? '' : ' — olmaz'}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="btn btn--card"
              disabled={disabled || !target}
              onClick={() => target && onPick(o, target.ref)}
            >
              {o.picked ? 'Bir tane daha' : 'Karar ver'}
            </button>
          </>
        )}
      </footer>
    </article>
  )
}
