import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { GameView } from '@shared/game/view'
import type { Notice } from '../lib/useGame'

interface Props {
  view: GameView
  busy: boolean
  notice: Notice | null
  deckOpen: boolean
  onToggleDeck: () => void
  onCommand: (text: string) => Promise<boolean>
  onUnpick: (id: string) => void
  onEndTurn: () => void
}

export function CommandBar({ view, busy, notice, deckOpen, onToggleDeck, onCommand, onUnpick, onEndTurn }: Props): React.JSX.Element {
  const [order, setOrder] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const playing = view.status === 'playing'
  const canSend = playing && !busy && order.trim().length > 0

  useEffect(() => {
    if (playing) inputRef.current?.focus()
  }, [playing])

  const submit = async (e?: FormEvent): Promise<void> => {
    e?.preventDefault()
    if (!canSend) return
    const text = order.trim()
    // The message moves to the briefing at once; it comes back only if it could not be sent.
    setOrder('')
    if (!(await onCommand(text))) setOrder(text)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (playing && !busy) onEndTurn()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  const { left, max } = view.player.capital

  return (
    <form className="command hud-panel" onSubmit={(e) => void submit(e)}>
      <div className="command__plan">
        <span className="eyebrow">Bu ay</span>
        {view.pending.length === 0 ? (
          <span className="command__empty">Henüz karar yok; hiçbir şey yapmamak da bir karardır.</span>
        ) : (
          <ul className="pending">
            {view.pending.map((p) => (
              <li key={p.id} className="pending__item" title={p.order ?? undefined}>
                <span>
                  {p.label}
                  {p.targetName && <em> · {p.targetName}</em>}
                </span>
                <button type="button" className="pending__drop" onClick={() => onUnpick(p.id)} disabled={busy} aria-label={`${p.label} kararını geri al`}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <span className="command__capital">
          {left}/{max} sermaye kaldı
        </span>
        <button type="button" className={`btn btn--ghost btn--deck${deckOpen ? ' btn--on' : ''}`} onClick={onToggleDeck} aria-expanded={deckOpen}>
          Hazır kararlar
        </button>
      </div>

      {notice && (
        <p key={notice.id} className={`command__notice command__notice--${notice.tone}`} role="status">
          {notice.text}
        </p>
      )}

      <div className="command__row">
        <label className="command__label" htmlFor="order">
          Emir
        </label>
        <textarea
          id="order"
          ref={inputRef}
          className="command__input"
          rows={1}
          value={order}
          onChange={(e) => setOrder(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={'Emir ya da soru: "Suriye sınırına asker yığ" · "Durum nedir?"'}
          disabled={!playing}
          spellCheck={false}
        />
        <button type="submit" className="btn btn--ghost" disabled={!canSend}>
          Gönder
        </button>
        <button type="button" className="btn btn--primary btn--turn" onClick={onEndTurn} disabled={!playing || busy}>
          {busy ? 'Bekleniyor…' : 'Turu bitir'}
          <kbd>Ctrl ↵</kbd>
        </button>
      </div>
    </form>
  )
}
