import type { GameView } from '@shared/game/view'
import { monthYear } from '../lib/format'

export function GameOver({ view, busy, onNewGame }: { view: GameView; busy: boolean; onNewGame: () => void }): React.JSX.Element | null {
  const ending = view.ending
  if (!ending) return null
  const approval = view.player.bars.find((b) => b.id === 'approval')?.value
  const stability = view.player.bars.find((b) => b.id === 'stability')?.value
  return (
    <div className="overlay overlay--end" role="dialog" aria-modal="true" aria-labelledby="end-title">
      <div className={`sheet sheet--end sheet--${ending.kind}`}>
        <span className="eyebrow">Oyun bitti · {monthYear(view.date)}</span>
        <h2 id="end-title" className="end__title">
          {ending.title}
        </h2>
        <p className="end__detail">{ending.detail}</p>
        <dl className="end__stats">
          <div>
            <dt>İktidarda</dt>
            <dd>{ending.turn} ay</dd>
          </div>
          <div>
            <dt>Kazanılan seçim</dt>
            <dd>{view.player.election.won}</dd>
          </div>
          <div>
            <dt>Son onay</dt>
            <dd>%{approval}</dd>
          </div>
          <div>
            <dt>Son istikrar</dt>
            <dd>{stability}</dd>
          </div>
        </dl>
        <p className="end__hint">Brifingde neyin nereden geldiğini okuyabilirsin. Kelebeklerin izi orada.</p>
        <button type="button" className="btn btn--primary" onClick={onNewGame} disabled={busy} autoFocus>
          Yeni oyun
        </button>
      </div>
    </div>
  )
}
