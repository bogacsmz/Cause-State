import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { AiStatus } from '@shared/ipc'
import type { DecisionOption } from '@shared/game/view'
import type { EntityRef } from '@shared/game/primitives'
import { BriefingPanel } from './components/BriefingPanel'
import { CommandBar } from './components/CommandBar'
import { DecisionDeck } from './components/DecisionDeck'
import { GameOver } from './components/GameOver'
import { NationPanel } from './components/NationPanel'
import { TopBar } from './components/TopBar'
import { TurnReport } from './components/TurnReport'
import { useGame } from './lib/useGame'
import { MapInfo } from './map/MapInfo'
import { MapView, type MapSelection } from './map/MapView'

/**
 * The HUD floats over the full-window map; the map never shrinks. These are the room the
 * panels take on each side (px), shared by the CSS and the map's camera padding, so the
 * camera keeps the player's country in the open middle. Side panels fold away.
 */
const HUD = { gap: 12, top: 52, left: 290, right: 340, bottom: 118 }

function hudLayout(leftOpen: boolean, rightOpen: boolean): { vars: CSSProperties; padding: { top: number; left: number; right: number; bottom: number } } {
  const left = leftOpen ? HUD.left : 0
  const right = rightOpen ? HUD.right : 0
  return {
    vars: {
      '--hud-gap': `${HUD.gap}px`,
      '--hud-top': `${HUD.top}px`,
      '--hud-left': `${left}px`,
      '--hud-right': `${right}px`,
      '--hud-bottom': `${HUD.bottom}px`
    } as CSSProperties,
    padding: {
      top: HUD.top + HUD.gap + 36,
      left: HUD.gap + left + HUD.gap,
      right: HUD.gap + right + HUD.gap,
      bottom: HUD.bottom + HUD.gap
    }
  }
}

/** A remembered on/off (which panels are folded). Storage can be missing; then it just resets. */
function useRemembered(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem(key)
      return saved === null ? initial : saved === '1'
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (v: boolean) => {
      setValue(v)
      try {
        localStorage.setItem(key, v ? '1' : '0')
      } catch {
        // not remembered, still works
      }
    },
    [key]
  )
  return [value, set]
}

export function App(): React.JSX.Element {
  const game = useGame()
  const [ai, setAi] = useState<AiStatus | null>(null)

  useEffect(() => {
    window.cs.ai
      .status()
      .then(setAi)
      .catch(() => setAi(null))
  }, [])

  const { pick } = game
  const onPick = useCallback((o: DecisionOption, target: EntityRef) => pick(o.effectId, target), [pick])
  const [deckOpen, setDeckOpen] = useState(false)
  const [selection, setSelection] = useState<MapSelection | null>(null)
  const [leftOpen, setLeftOpen] = useRemembered('cs.hud.left', true)
  const [rightOpen, setRightOpen] = useRemembered('cs.hud.right', true)
  const view = game.view
  const hud = useMemo(() => hudLayout(leftOpen, rightOpen), [leftOpen, rightOpen])
  const closeInfo = useCallback(() => setSelection(null), [])

  // The briefing opens by itself when there is something to read as it is written.
  const busyTalking = Boolean(game.liveChat || game.liveTurn)
  useEffect(() => {
    if (busyTalking && !rightOpen) setRightOpen(true)
  }, [busyTalking, rightOpen, setRightOpen])

  return (
    <div className="app" style={hud.vars}>
      <MapView game={view?.map} padding={hud.padding} selection={selection} onSelect={setSelection} />
      <TopBar platform={window.cs.platform} view={view} ai={ai} onNewGame={game.newGame} />
      {selection && <MapInfo selection={selection} game={view?.map} onSelect={setSelection} onClose={closeInfo} />}
      {!view ? (
        <p className="loading">{game.loadError ? `Oyun açılamadı: ${game.loadError}` : 'Masa hazırlanıyor…'}</p>
      ) : (
        <>
          {leftOpen ? (
            <NationPanel view={view} onFold={() => setLeftOpen(false)} />
          ) : (
            <button type="button" className="hud-tab hud-tab--left" onClick={() => setLeftOpen(true)}>
              {view.player.name} <span aria-hidden>›</span>
            </button>
          )}
          <div className="hud-center">
            {deckOpen && <DecisionDeck view={view} busy={game.busy} onPick={onPick} onClose={() => setDeckOpen(false)} />}
            <CommandBar
              view={view}
              busy={game.busy}
              notice={game.notice}
              deckOpen={deckOpen}
              onToggleDeck={() => setDeckOpen((open) => !open)}
              onCommand={game.command}
              onUnpick={game.unpick}
              onEndTurn={game.endTurn}
            />
          </div>
          {rightOpen ? (
            <BriefingPanel view={view} liveChat={game.liveChat} liveTurn={game.liveTurn} onFold={() => setRightOpen(false)} />
          ) : (
            <button type="button" className="hud-tab hud-tab--right" onClick={() => setRightOpen(true)}>
              <span aria-hidden>‹</span> Brifing
            </button>
          )}
          {game.reportOpen && view.status === 'playing' && <TurnReport view={view} onClose={game.closeReport} />}
          {view.status === 'lost' && <GameOver view={view} busy={game.busy} onNewGame={game.newGame} />}
        </>
      )}
    </div>
  )
}
