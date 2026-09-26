import type { AiStatus } from '@shared/ipc'

interface Props {
  platform: string
  status: AiStatus | null
  onRefreshStatus: () => void
}

export function TopBar({ platform, status, onRefreshStatus }: Props): React.JSX.Element {
  return (
    <header className="topbar" data-platform={platform}>
      <div className="brand">
        Cause <em>&amp;</em> State
      </div>

      <div className="calendar" aria-label="Oyun takvimi">
        <span className="calendar__date">Ocak 2026</span>
        <span className="calendar__sep" aria-hidden="true" />
        <span className="calendar__turn">Tur 0</span>
      </div>

      <StatusPill status={status} onClick={onRefreshStatus} />
    </header>
  )
}

function StatusPill({ status, onClick }: { status: AiStatus | null; onClick: () => void }): React.JSX.Element {
  const tone = status === null ? 'pending' : status.ready ? 'ok' : 'down'
  const label = status?.label ?? 'Bağlanıyor…'
  return (
    <button
      type="button"
      className={`status status--${tone}`}
      onClick={onClick}
      title={status ? `${status.detail}\n\nYenilemek için tıkla.` : undefined}
    >
      <span className="status__dot" aria-hidden="true" />
      <span className="status__label">{label}</span>
    </button>
  )
}
