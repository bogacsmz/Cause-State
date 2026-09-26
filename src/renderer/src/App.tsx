import { useCallback, useEffect, useState } from 'react'
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
  const view = game.view

  if (!view) {
    return (
      <div className="app app--loading">
        <TopBar platform={window.cs.platform} view={null} ai={ai} onNewGame={game.newGame} />
        <p className="loading">{game.loadError ? `Oyun açılamadı: ${game.loadError}` : 'Masa hazırlanıyor…'}</p>
      </div>
    )
  }

  return (
    <div className="app">
      <TopBar platform={window.cs.platform} view={view} ai={ai} onNewGame={game.newGame} />
      <main className="desk">
        <NationPanel view={view} />
        <DecisionDeck view={view} busy={game.busy} onPick={onPick} />
      </main>
      <CommandBar
        view={view}
        busy={game.busy}
        notice={game.notice}
        onCommand={game.command}
        onUnpick={game.unpick}
        onEndTurn={game.endTurn}
      />
      <BriefingPanel view={view} liveChat={game.liveChat} liveTurn={game.liveTurn} />
      {game.reportOpen && view.status === 'playing' && <TurnReport view={view} onClose={game.closeReport} />}
      {view.status === 'lost' && <GameOver view={view} busy={game.busy} onNewGame={game.newGame} />}
    </div>
  )
}
