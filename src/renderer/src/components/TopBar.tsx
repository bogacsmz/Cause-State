import type { AiStatus } from '@shared/ipc'
import type { GameView } from '@shared/game/view'
import { monthYear } from '../lib/format'

interface Props {
  platform: string
  view: GameView | null
  ai: AiStatus | null
  onNewGame: () => void
}

export function TopBar({ platform, view, ai, onNewGame }: Props): React.JSX.Element {
  const left = view?.player.election.turnsLeft
  return (
    <header className="topbar" data-platform={platform}>
      <div className="brand">
        Cause <em>&amp;</em> State
      </div>

      <div className="calendar" aria-label="Oyun takvimi">
        <span className="calendar__date">{view ? monthYear(view.date) : '—'}</span>
        <span className="calendar__sep" aria-hidden="true" />
        <span className="calendar__turn">Tur {view?.turn ?? 0}</span>
        {view?.status === 'playing' && left !== undefined && (
          <>
            <span className="calendar__sep" aria-hidden="true" />
            <span className={`calendar__vote${left <= 3 ? ' calendar__vote--soon' : ''}`}>
              {left === 0 ? 'Seçim bu ay' : `Seçime ${left} ay`}
            </span>
          </>
        )}
      </div>

      <div className="topbar__end">
        <button type="button" className="linkbtn" onClick={onNewGame}>
          Yeni oyun
        </button>
        <AiPill ai={ai} />
      </div>
    </header>
  )
}

// Phase 1 plays with the scripted AI; the pill says so and shows whether Claude is ready for phase 2.
function AiPill({ ai }: { ai: AiStatus | null }): React.JSX.Element {
  const claude = ai ? `${ai.label}${ai.ready ? '' : ` (${ai.detail})`}` : 'kontrol ediliyor'
  return (
    <span
      className="status status--ok"
      title={`Faz 1: emirleri senaryo yapay zekası yorumluyor, kurallar ve sayılar koddan.\nClaude bağlantısı (Faz 2): ${claude}`}
    >
      <span className="status__dot" aria-hidden="true" />
      <span className="status__label">Senaryo YZ · Faz 1</span>
    </span>
  )
}
