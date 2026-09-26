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
        <AiPill ai={ai} brain={view?.ai.kind} />
      </div>
    </header>
  )
}

/** Who reads the orders: Claude (with its connection state) or the offline scripted rules. */
function AiPill({ ai, brain }: { ai: AiStatus | null; brain: 'claude' | 'scripted' | undefined }): React.JSX.Element {
  if (brain === 'scripted') {
    return (
      <span className="status status--ok" title="Çevrimdışı mod: emirleri kurallı senaryo yapay zekası yorumluyor. Sayılar ve kurallar her zaman koddan.">
        <span className="status__dot" aria-hidden="true" />
        <span className="status__label">Senaryo YZ</span>
      </span>
    )
  }
  const tone = ai === null ? 'pending' : ai.ready ? 'ok' : 'down'
  return (
    <span className={`status status--${tone}`} title={ai ? `${ai.detail}\nSayılar ve kurallar her zaman koddan; Claude önerir ve anlatır.` : undefined}>
      <span className="status__dot" aria-hidden="true" />
      <span className="status__label">{ai?.label ?? 'Claude bağlanıyor…'}</span>
    </span>
  )
}
