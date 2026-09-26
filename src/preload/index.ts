import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type AiEvent, type AiStatus, type CsBridge, type GameBridge } from '@shared/ipc'

// The only door between the UI and the rest of the app. The UI gets these few
// functions and nothing else: no Node, no filesystem, no raw IPC.
const bridge: CsBridge = {
  platform: process.platform,
  ai: {
    status: () => ipcRenderer.invoke(IPC.aiStatus) as Promise<AiStatus>,

    ask: (prompt, handlers) => {
      const id = crypto.randomUUID()
      let finished = false

      const listener = (_event: IpcRendererEvent, ev: AiEvent): void => {
        if (ev.id !== id) return
        if (ev.type === 'delta') {
          handlers.onDelta(ev.text)
          return
        }
        finished = true
        ipcRenderer.removeListener(IPC.aiEvent, listener)
        if (ev.type === 'done') handlers.onDone(ev.result)
        else handlers.onError(ev.message)
      }

      ipcRenderer.on(IPC.aiEvent, listener)
      ipcRenderer.send(IPC.aiAsk, { id, prompt })

      return () => {
        if (finished) return
        finished = true
        ipcRenderer.removeListener(IPC.aiEvent, listener)
        ipcRenderer.send(IPC.aiCancel, id)
      }
    }
  },
  game: {
    view: () => ipcRenderer.invoke(IPC.gameView) as ReturnType<GameBridge['view']>,
    newGame: () => ipcRenderer.invoke(IPC.gameNew) as ReturnType<GameBridge['newGame']>,
    command: (text) => ipcRenderer.invoke(IPC.gameCommand, text) as ReturnType<GameBridge['command']>,
    pick: (effectId, target) => ipcRenderer.invoke(IPC.gamePick, effectId, target) as ReturnType<GameBridge['pick']>,
    unpick: (pendingId) => ipcRenderer.invoke(IPC.gameUnpick, pendingId) as ReturnType<GameBridge['unpick']>,
    endTurn: () => ipcRenderer.invoke(IPC.gameEndTurn) as ReturnType<GameBridge['endTurn']>
  }
}

contextBridge.exposeInMainWorld('cs', bridge)
