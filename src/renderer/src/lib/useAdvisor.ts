import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiResult } from '@shared/ipc'

export type DispatchState = 'streaming' | 'done' | 'error' | 'cancelled'

export interface Dispatch {
  id: string
  order: string
  text: string
  state: DispatchState
  startedAt: number
  result?: AiResult
  error?: string
}

/** Sends orders to the advisor and keeps the briefing list, streaming answers in as they arrive. */
export function useAdvisor(): {
  dispatches: Dispatch[]
  busy: boolean
  ask: (order: string) => void
  cancel: () => void
} {
  const [dispatches, setDispatches] = useState<Dispatch[]>([])
  const cancelRef = useRef<(() => void) | null>(null)

  const ask = useCallback((order: string) => {
    if (cancelRef.current) return
    const id = crypto.randomUUID()
    setDispatches((prev) => [...prev, { id, order, text: '', state: 'streaming', startedAt: Date.now() }])

    const patch = (fn: (d: Dispatch) => Dispatch): void =>
      setDispatches((prev) => prev.map((d) => (d.id === id ? fn(d) : d)))

    // Deltas arrive faster than the screen refreshes; paint them once per frame.
    let pending = ''
    let frame = 0
    const flush = (): void => {
      frame = 0
      if (!pending) return
      const chunk = pending
      pending = ''
      patch((d) => ({ ...d, text: d.text + chunk }))
    }
    const finish = (fn: (d: Dispatch) => Dispatch): void => {
      if (frame) cancelAnimationFrame(frame)
      flush()
      patch(fn)
      cancelRef.current = null
    }

    const cancelIpc = window.cs.ai.ask(order, {
      onDelta: (text) => {
        pending += text
        if (!frame) frame = requestAnimationFrame(flush)
      },
      onDone: (result) => finish((d) => ({ ...d, state: 'done', result, text: result.text || d.text })),
      onError: (message) => finish((d) => ({ ...d, state: 'error', error: message }))
    })

    cancelRef.current = () => {
      cancelIpc()
      finish((d) => ({ ...d, state: 'cancelled' }))
    }
  }, [])

  const cancel = useCallback(() => cancelRef.current?.(), [])

  useEffect(() => () => cancelRef.current?.(), [])

  return { dispatches, busy: dispatches.some((d) => d.state === 'streaming'), ask, cancel }
}
