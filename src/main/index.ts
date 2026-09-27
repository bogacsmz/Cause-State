import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, session as electronSession, shell } from 'electron'
import { createProvider } from './ai'
import { readAiConfig } from './config'
import { ClaudeBrain, ScriptedBrain } from './game/claude/brain'
import { registerGameIpc } from './game/ipc'
import { GameSession } from './game/session'
import { registerAiIpc } from './ipc'
import { registerMapScheme, serveMap } from './map/protocol'

const APP_BACKGROUND = '#0b0f13'

app.setName('Cause & State')
// The map's tiles and fonts are served from inside the app (cs-map://); this must be declared before ready.
registerMapScheme()
// Machines without a usable GPU (virtual machines, headless CI): CS_SOFTWARE_GL=1 draws the
// map's WebGL in software. Real machines use their GPU and never need it.
if (process.env.CS_SOFTWARE_GL === '1') {
  app.commandLine.appendSwitch('ignore-gpu-blocklist')
  app.commandLine.appendSwitch('use-angle', 'swiftshader')
  app.commandLine.appendSwitch('enable-unsafe-swiftshader')
}

// One running copy only; a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  void app
    .whenReady()
    .then(start)
    .catch((err: unknown) => {
      dialog.showErrorBox('Cause & State açılamadı', err instanceof Error ? err.message : String(err))
      app.quit()
    })
}

async function start(): Promise<void> {
  // The game talks to nothing but the AI. Without this, Chromium fetches Hunspell
  // dictionaries from Google at start (Windows/Linux; macOS uses its own checker).
  electronSession.defaultSession.setSpellCheckerEnabled(false)
  electronSession.defaultSession.setSpellCheckerLanguages([])
  loadDevEnv()
  const config = readAiConfig(process.env)
  // An empty temp directory: the CLI must not pick up a project's CLAUDE.md or hooks.
  const provider = createProvider(config, { workDir: join(tmpdir(), 'cause-state-claude') })
  registerAiIpc(provider)

  // Save files live in the user's app data folder. For tests and demos, CS_SAVE_DIR moves
  // them and CS_GAME_SEED / CS_GAME_ID make the first new game reproducible.
  // Claude reads the orders and plays the world; the offline mock provider means the
  // scripted rules from phase 1 (tests, demos without Claude).
  const brain = provider.id === 'mock' ? new ScriptedBrain() : new ClaudeBrain(provider)
  const session = await GameSession.open(process.env.CS_SAVE_DIR ?? join(app.getPath('userData'), 'saves'), {
    brain,
    first: {
      ...(process.env.CS_GAME_SEED ? { seed: Number(process.env.CS_GAME_SEED) } : {}),
      ...(process.env.CS_GAME_ID ? { gameId: process.env.CS_GAME_ID } : {})
    }
  })
  registerGameIpc(session)
  app.on('will-quit', () => session.close())
  // Proof scripts only: change GameState from outside, in memory (never in a normal game).
  if (process.env.CS_TEST_HOOKS === '1') {
    Object.assign(globalThis, {
      __csDebug: { setProvince: (id: string, owner: string, controller: string) => session.debugSetProvince(id, owner, controller).then(() => true) }
    })
  }
  serveMap()

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/** In development, settings come from a .env file next to package.json. */
function loadDevEnv(): void {
  if (app.isPackaged) return
  const file = join(app.getAppPath(), '.env')
  if (existsSync(file)) process.loadEnvFile(file)
}

function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'Cause & State',
    backgroundColor: APP_BACKGROUND,
    ...(isMac ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 18 } } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // The game never navigates away or opens windows; real links go to the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  return win
}
