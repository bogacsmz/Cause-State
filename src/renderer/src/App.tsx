import { useCallback, useEffect, useState, type CSSProperties } from 'react'
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
import { MapView } from './map/MapView'

/**
 * The HUD floats over the full-window map; the map never shrinks. These are the room the
 * panels take on each side (px), shared by the CSS and the map's camera padding, so the
 * camera centres places in the open middle.
 */
const HUD = { gap: 12, top: 52, left: 330, right: 380, bottom: 118 }
const CAMERA_PADDING = {
  top: HUD.top + HUD.gap,
  left: HUD.gap + HUD.left,
  right: HUD.gap + HUD.right,
  bottom: HUD.bottom + HUD.gap
}
const HUD_VARS = {
  '--hud-gap': `${HUD.gap}px`,
  '--hud-top': `${HUD.top}px`,
  '--hud-left': `${HUD.left}px`,
  '--hud-right': `${HUD.right}px`
} as CSSProperties

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
  const view = game.view

  return (
    <div className="app" style={HUD_VARS}>
      <MapView padding={CAMERA_PADDING} />
      <TopBar platform={window.cs.platform} view={view} ai={ai} onNewGame={game.newGame} />
      {!view ? (
        <p className="loading">{game.loadError ? `Oyun açılamadı: ${game.loadError}` : 'Masa hazırlanıyor…'}</p>
      ) : (
        <>
          <NationPanel view={view} />
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
          <BriefingPanel view={view} liveChat={game.liveChat} liveTurn={game.liveTurn} />
          {game.reportOpen && view.status === 'playing' && <TurnReport view={view} onClose={game.closeReport} />}
          {view.status === 'lost' && <GameOver view={view} busy={game.busy} onNewGame={game.newGame} />}
        </>
      )}
    </div>
  )
}
