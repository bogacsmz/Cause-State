import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type AiStatus, type CsBridge, type GameBridge } from '@shared/ipc'

// The only door between the UI and the rest of the app. The UI gets these few
// functions and nothing else: no Node, no filesystem, no raw IPC.
const bridge: CsBridge = {
  platform: process.platform,
  ai: {
    status: () => ipcRenderer.invoke(IPC.aiStatus) as Promise<AiStatus>
  },
  game: {
    view: () => ipcRenderer.invoke(IPC.gameView) as ReturnType<GameBridge['view']>,
    newGame: () => ipcRenderer.invoke(IPC.gameNew) as ReturnType<GameBridge['newGame']>,
    command: (text) => ipcRenderer.invoke(IPC.gameCommand, text) as ReturnType<GameBridge['command']>,
    pick: (effectId, target) => ipcRenderer.invoke(IPC.gamePick, effectId, target) as ReturnType<GameBridge['pick']>,
    unpick: (pendingId) => ipcRenderer.invoke(IPC.gameUnpick, pendingId) as ReturnType<GameBridge['unpick']>,
    endTurn: () => ipcRenderer.invoke(IPC.gameEndTurn) as ReturnType<GameBridge['endTurn']>,
    onProgress: (listener) => {
      const handler = (_event: IpcRendererEvent, progress: Parameters<typeof listener>[0]): void => listener(progress)
      ipcRenderer.on(IPC.gameProgress, handler)
      return () => ipcRenderer.removeListener(IPC.gameProgress, handler)
    }
  }
}

contextBridge.exposeInMainWorld('cs', bridge)
