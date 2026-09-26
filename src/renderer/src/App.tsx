import { useCallback, useEffect, useState } from 'react'
import type { AiStatus } from '@shared/ipc'
import { BriefingPanel } from './components/BriefingPanel'
import { CommandBar } from './components/CommandBar'
import { MapStage } from './components/MapStage'
import { TopBar } from './components/TopBar'
import { useAdvisor } from './lib/useAdvisor'

export function App(): React.JSX.Element {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const { dispatches, busy, ask, cancel } = useAdvisor()

  const refreshStatus = useCallback(() => {
    setStatus(null)
    window.cs.ai
      .status()
      .then(setStatus)
      .catch((err: unknown) =>
        setStatus({ provider: 'cli', ready: false, label: 'Durum alınamadı', detail: String(err) })
      )
  }, [])

  useEffect(refreshStatus, [refreshStatus])

  return (
    <div className="app">
      <TopBar platform={window.cs.platform} status={status} onRefreshStatus={refreshStatus} />
      <MapStage />
      <CommandBar status={status} busy={busy} onSend={ask} onCancel={cancel} />
      <BriefingPanel dispatches={dispatches} />
    </div>
  )
}
