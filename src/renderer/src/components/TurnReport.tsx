import { useEffect, useRef } from 'react'
import type { GameView } from '@shared/game/view'
import { ek } from '@shared/tr'
import { monthYear, percent, signed } from '../lib/format'
import { Delta } from './NationPanel'

// The end-of-turn sheet: what moved, and why. The butterfly, if one came back, goes first.
export function TurnReport({ view, onClose }: { view: GameView; onClose: () => void }): React.JSX.Element | null {
  const report = view.report
  const continueRef = useRef<HTMLButtonElement>(null)
  // Focus "Devam" without scrolling a long report away from its top.
  useEffect(() => continueRef.current?.focus({ preventScroll: true }), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  if (!report) return null

  const echoes = view.feed.filter((e) => e.turn === report.turn && e.kind === 'seed_fired')
  // Same order as the desk: approval first.
  const order = view.player.bars.map((b) => b.id)
  const moved = report.bars
    .filter((b) => b.after !== b.before || b.causes.length > 0)
    .sort((a, b) => order.indexOf(a.bar) - order.indexOf(b.bar))
  const labels = new Map(view.player.bars.map((b) => [b.id, b.label]))

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="report-title" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <header className="sheet__head">
          <span className="eyebrow">Tur sonu raporu</span>
          <h2 id="report-title">
            Tur {report.turn} · {monthYear(report.date)}
          </h2>
        </header>

        {echoes.map((e) => (
          <div key={e.id} className={`sheet__echo${e.origin?.butterfly === false ? ' sheet__echo--world' : ''}`}>
            <span className="echo__tag">{e.origin?.butterfly === false ? 'Dünya gündemi' : 'Kelebek etkisi'}</span>
            <strong>{e.title.replace(/^(Kelebek etkisi|Dünya gündemi): /, '')}</strong>
            <p>{e.summary}</p>
            {e.origin && (
              <p className="echo__origin">
                {e.origin.butterfly
                  ? `Tur ${ek(e.origin.turn, 'de')} verdiğin "${e.origin.label}" kararı geri döndü.`
                  : `Tur ${ek(e.origin.turn, 'de')} haberlere düşmüştü.`}
              </p>
            )}
          </div>
        ))}

        {report.election && (
          <div className={`sheet__verdict ${report.election.won ? 'sheet__verdict--won' : 'sheet__verdict--lost'}`}>
            Seçim: oyların %{ek(report.election.vote, 'i')} (baraj %{report.election.threshold}) —{' '}
            {report.election.won ? 'kazandın' : 'kaybettin'}
          </div>
        )}
        {report.coup && !report.coup.happened && (
          <div className="sheet__verdict sheet__verdict--warn">Darbe riski {percent(report.coup.chance)} idi; ordu bu ay kışlada kaldı.</div>
        )}

        <table className="changes">
          <tbody>
            {moved.map((b) => (
              <tr key={b.bar}>
                <th scope="row">{labels.get(b.bar)}</th>
                <td className="changes__values">
                  {b.before} → <strong>{b.after}</strong>
                </td>
                <td className="changes__delta">
                  <Delta n={b.after - b.before} />
                </td>
                <td className="changes__why">
                  {b.causes.map((c, i) => (
                    <span key={i} className={`why why--${c.kind}`}>
                      {c.label} <em className={c.delta > 0 ? 'up' : 'down'}>{signed(c.delta)}</em>
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <footer className="sheet__foot">
          <span>
            {report.expired.length > 0 ? `Sona eren: ${report.expired.join(', ')} · ` : ''}
            Yeni ay: {report.capital.next} sermaye
          </span>
          <button type="button" className="btn btn--primary" onClick={onClose} ref={continueRef}>
            Devam
          </button>
        </footer>
      </div>
    </div>
  )
}
