import { useCallback, useEffect, useRef, useState } from 'react'
import type { EffectId } from '@shared/game/catalog'
import type { EntityRef } from '@shared/game/primitives'
import type { GameProgress, GameView } from '@shared/game/view'

export interface Notice {
  id: number
  tone: 'ok' | 'info' | 'error'
  text: string
}

/** A message the cabinet is still answering: shown in the briefing as it streams. */
export interface LiveChat {
  id: string
  text: string
  reply: string
  rejected: Array<{ reply: string; reasons: string[] }>
}

/** The month being played out: which step, and the news as it is written. */
export interface LiveTurn {
  phase: 'world' | 'referee' | 'news' | null
  narration: string
}

declare global {
  interface Window {
    __csRefresh?: () => Promise<void>
  }
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
  liveChat: LiveChat | null
  liveTurn: LiveTurn | null
} {
  const [view, setView] = useState<GameView | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [liveChat, setLiveChat] = useState<LiveChat | null>(null)
  const [liveTurn, setLiveTurn] = useState<LiveTurn | null>(null)
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
    // For the proof scripts: re-read the game after they change it in the main process.
    window.__csRefresh = () => window.cs.game.view().then(setView)
    return () => {
      delete window.__csRefresh
    }
  }, [])

  // Live progress from the main process: the cabinet's reply and the month's news as they stream.
  useEffect(
    () =>
      window.cs.game.onProgress((event: GameProgress) => {
        switch (event.kind) {
          case 'chat':
            setLiveChat({ id: event.chatId, text: event.text, reply: '', rejected: [] })
            break
          case 'reply':
            setLiveChat((c) => (c && c.id === event.chatId ? { ...c, reply: event.text } : c))
            break
          case 'rejected':
            setLiveChat((c) =>
              c && c.id === event.chatId ? { ...c, reply: '', rejected: [...c.rejected, { reply: event.reply, reasons: event.reasons }] } : c
            )
            break
          case 'phase':
            setLiveTurn((t) => ({ phase: event.phase, narration: t?.narration ?? '' }))
            break
          case 'narration':
            setLiveTurn((t) => ({ phase: t?.phase ?? 'news', narration: (t?.narration ?? '') + event.delta }))
            break
        }
      }),
    []
  )

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
      const result = await guarded(async () => {
        try {
          return await window.cs.game.command(text)
        } finally {
          setLiveChat(null)
        }
      })
      if (!result) return false
      setView(result.view)
      if (result.view.ai.notice) say('info', result.view.ai.notice)
      return true
    },
    [guarded, say]
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
      setLiveTurn({ phase: null, narration: '' })
      try {
        const next = await window.cs.game.endTurn()
        setView(next)
        setReportOpen(next.report !== null)
        if (next.ai.notice) say('info', next.ai.notice)
      } finally {
        setLiveTurn(null)
      }
    })
  }, [guarded, say])

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
    loadError,
    liveChat,
    liveTurn
  }
}

function message(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  // Electron prefixes errors thrown in the main process; the player only needs the reason.
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
