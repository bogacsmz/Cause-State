import { useCallback, useEffect, useRef, useState } from 'react'
import type { EffectId } from '@shared/game/catalog'
import type { EntityRef } from '@shared/game/primitives'
import type { GameView } from '@shared/game/view'

export interface Notice {
  id: number
  tone: 'ok' | 'info' | 'error'
  text: string
}

/** The game as the UI sees it: the latest view from the main process, plus UI-only state. */
export function useGame(): {
  view: GameView | null
  busy: boolean
  notice: Notice | null
  /** Whether the end-of-turn report sheet is open. */
  reportOpen: boolean
  closeReport: () => void
  openReport: () => void
  command: (text: string) => Promise<boolean>
  pick: (effectId: EffectId, target: EntityRef) => void
  unpick: (id: string) => void
  endTurn: () => void
  newGame: () => void
  loadError: string | null
} {
  const [view, setView] = useState<GameView | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const noticeId = useRef(0)
  const busyRef = useRef(false)

  const say = useCallback((tone: Notice['tone'], text: string) => {
    noticeId.current += 1
    setNotice({ id: noticeId.current, tone, text })
  }, [])

  useEffect(() => {
    window.cs.game
      .view()
      .then(setView)
      .catch((err: unknown) => setLoadError(message(err)))
  }, [])

  // Runs one call at a time; the main process queues too, this just keeps the buttons honest.
  const guarded = useCallback(
    async <T,>(task: () => Promise<T>): Promise<T | undefined> => {
      if (busyRef.current) return undefined
      busyRef.current = true
      setBusy(true)
      try {
        return await task()
      } catch (err) {
        say('error', message(err))
        return undefined
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [say]
  )

  const command = useCallback(
    async (text: string): Promise<boolean> => {
      const result = await guarded(() => window.cs.game.command(text))
      if (!result) return false
      setView(result.view)
      return true
    },
    [guarded]
  )

  const pick = useCallback(
    (effectId: EffectId, target: EntityRef) => {
      void guarded(async () => {
        const result = await window.cs.game.pick(effectId, target)
        setView(result.view)
        if (!result.ok && result.message) say('error', result.message)
      })
    },
    [guarded, say]
  )

  const unpick = useCallback(
    (id: string) => {
      void guarded(async () => setView(await window.cs.game.unpick(id)))
    },
    [guarded]
  )

  const endTurn = useCallback(() => {
    void guarded(async () => {
      const next = await window.cs.game.endTurn()
      setView(next)
      setReportOpen(next.report !== null)
    })
  }, [guarded])

  const newGame = useCallback(() => {
    void guarded(async () => {
      setView(await window.cs.game.newGame())
      setReportOpen(false)
    })
  }, [guarded])

  return {
    view,
    busy,
    notice,
    reportOpen,
    closeReport: useCallback(() => setReportOpen(false), []),
    openReport: useCallback(() => setReportOpen(true), []),
    command,
    pick,
    unpick,
    endTurn,
    newGame,
    loadError
  }
}

function message(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  // Electron prefixes errors thrown in the main process; the player only needs the reason.
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
