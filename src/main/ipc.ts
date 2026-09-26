import { ipcMain } from 'electron'
import { IPC, type AiEvent, type AskRequest } from '@shared/ipc'
import { isAbortError, LlmError, type LlmProvider } from './ai'

const MAX_PROMPT_CHARS = 8000

export function registerAiIpc(provider: LlmProvider, systemPrompt: string): void {
  const running = new Map<string, AbortController>()

  ipcMain.handle(IPC.aiStatus, () => provider.status())

  ipcMain.on(IPC.aiAsk, (event, req: AskRequest) => {
    if (!isAskRequest(req)) return
    const { sender } = event
    const send = (ev: AiEvent): void => {
      if (!sender.isDestroyed()) sender.send(IPC.aiEvent, ev)
    }

    const prompt = req.prompt.trim()
    if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
      send({ id: req.id, type: 'error', message: `Emir boş olamaz ve en fazla ${MAX_PROMPT_CHARS} karakter olabilir.` })
      return
    }

    const controller = new AbortController()
    running.set(req.id, controller)

    provider
      .generate({
        system: systemPrompt,
        prompt,
        signal: controller.signal,
        onText: (text) => send({ id: req.id, type: 'delta', text })
      })
      .then((result) => send({ id: req.id, type: 'done', result }))
      .catch((err: unknown) => {
        if (isAbortError(err)) return
        if (!(err instanceof LlmError)) console.error('[ai] beklenmeyen hata', err)
        const message =
          err instanceof LlmError ? err.message : `Beklenmeyen bir hata oluştu: ${err instanceof Error ? err.message : String(err)}`
        send({ id: req.id, type: 'error', message })
      })
      .finally(() => running.delete(req.id))
  })

  ipcMain.on(IPC.aiCancel, (_event, id: unknown) => {
    if (typeof id === 'string') running.get(id)?.abort()
  })
}

function isAskRequest(value: unknown): value is AskRequest {
  const v = value as Partial<AskRequest> | null
  return typeof v?.id === 'string' && typeof v.prompt === 'string'
}
