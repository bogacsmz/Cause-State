import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { LlmProvider } from './ai'

/** The AI connection's status for the UI. Game calls to Claude go through the game session. */
export function registerAiIpc(provider: LlmProvider): void {
  ipcMain.handle(IPC.aiStatus, () => provider.status())
}
