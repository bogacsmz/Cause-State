import { useEffect, useRef } from 'react'
import { clockTime, resultMeta } from '../lib/format'
import type { Dispatch } from '../lib/useAdvisor'

export function BriefingPanel({ dispatches }: { dispatches: Dispatch[] }): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)
  const last = dispatches.at(-1)

  // Follow the newest answer while it streams, unless the player scrolled up to read.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom || last?.text === '') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [dispatches, last?.text])

  return (
    <aside className="briefing" aria-label="Brifing">
      <header className="panel-head">
        <span className="eyebrow">Brifing</span>
        <span className="panel-head__meta">{dispatches.length} kayıt</span>
      </header>

      <div className="briefing__list" ref={listRef}>
        {dispatches.length === 0 ? (
          <EmptyDesk />
        ) : (
          dispatches.map((d) => <DispatchCard key={d.id} dispatch={d} />)
        )}
      </div>
    </aside>
  )
}

function DispatchCard({ dispatch: d }: { dispatch: Dispatch }): React.JSX.Element {
  const waiting = d.state === 'streaming' && d.text === ''
  return (
    <article className={`dispatch dispatch--${d.state}`}>
      <header className="dispatch__head">
        <span className="dispatch__tag">Danışman</span>
        <time>{clockTime(d.startedAt)}</time>
      </header>

      <p className="dispatch__order">{d.order}</p>

      {waiting ? (
        <p className="dispatch__pending">Danışman düşünüyor</p>
      ) : (
        d.text && (
          <div className="dispatch__body">
            {d.text}
            {d.state === 'streaming' && <span className="caret" aria-hidden="true" />}
          </div>
        )
      )}

      {d.state === 'error' && <p className="dispatch__error">{d.error}</p>}
      {d.state === 'cancelled' && <p className="dispatch__note">Durduruldu.</p>}
      {d.result && (
        <footer className="dispatch__meta">
          {resultMeta(d.result).map((part) => (
            <span key={part}>{part}</span>
          ))}
        </footer>
      )}
    </article>
  )
}

function EmptyDesk(): React.JSX.Element {
  return (
    <div className="empty">
      <svg className="empty__seal" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="29" />
        <circle cx="32" cy="32" r="22" />
        <path d="M32 14v36M14 32h36" />
      </svg>
      <p>Masa boş.</p>
      <p className="empty__hint">Aşağıdaki satıra bir emir ya da soru yaz. Danışmanın cevabı burada belirecek.</p>
    </div>
  )
}
