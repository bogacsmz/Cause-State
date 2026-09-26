import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { AiStatus } from '@shared/ipc'

interface Props {
  status: AiStatus | null
  busy: boolean
  onSend: (order: string) => void
  onCancel: () => void
}

export function CommandBar({ status, busy, onSend, onCancel }: Props): React.JSX.Element {
  const [order, setOrder] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const ready = status?.ready === true
  const canSend = ready && !busy && order.trim().length > 0

  useEffect(() => {
    if (ready) inputRef.current?.focus()
  }, [ready])

  useEffect(() => {
    if (!busy) return
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  const submit = (e?: FormEvent): void => {
    e?.preventDefault()
    if (!canSend) return
    onSend(order.trim())
    setOrder('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <form className="command" onSubmit={submit}>
      {status && !status.ready && (
        <p className="command__notice" role="status">
          {status.label}: {status.detail}
        </p>
      )}

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
        placeholder="Bakanlığa, orduya ya da danışmana bir emir yaz…"
        disabled={!ready}
        spellCheck={false}
      />

      <div className="command__actions">
        {busy ? (
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Durdur <kbd>Esc</kbd>
          </button>
        ) : (
          <button type="submit" className="btn btn--primary" disabled={!canSend}>
            Gönder
          </button>
        )}
        <span className="command__hint">Enter gönder · Shift+Enter yeni satır</span>
      </div>
    </form>
  )
}
