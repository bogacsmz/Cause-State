import { BrowserWindow, ipcMain } from 'electron'
import { EffectId } from '@shared/game/catalog'
import { LIMITS } from '@shared/game/contract'
import { EntityRef } from '@shared/game/primitives'
import { IPC } from '@shared/ipc'
import type { GameSession } from './session'

// The UI is untrusted: every argument is checked before it reaches the game.
export function registerGameIpc(session: GameSession): void {
  // Streamed replies and news go to every open window as they are written.
  session.onProgress((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.webContents.isDestroyed()) win.webContents.send(IPC.gameProgress, event)
    }
  })

  ipcMain.handle(IPC.gameView, () => session.view())
  ipcMain.handle(IPC.gameNew, () => session.newGame())
  ipcMain.handle(IPC.gameEndTurn, () => session.endTurn())

  ipcMain.handle(IPC.gameCommand, (_event, text: unknown) => {
    if (typeof text !== 'string' || !text.trim() || text.length > LIMITS.orderChars) {
      throw new Error(`Emir boş olamaz ve en fazla ${LIMITS.orderChars} karakter olabilir.`)
    }
    return session.command(text)
  })

  ipcMain.handle(IPC.gamePick, (_event, effectId: unknown, target: unknown) => {
    const id = EffectId.safeParse(effectId)
    const ref = EntityRef.safeParse(target)
    if (!id.success || !ref.success) throw new Error('Geçersiz karar.')
    return session.pick(id.data, ref.data)
  })

  ipcMain.handle(IPC.gameUnpick, (_event, pendingId: unknown) => {
    if (typeof pendingId !== 'string') throw new Error('Geçersiz karar.')
    return session.unpick(pendingId)
  })
}
