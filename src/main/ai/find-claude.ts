import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

export interface ResolvedCommand {
  /** Absolute path of the `claude` executable. */
  path: string
  /** Environment to run it with; PATH already includes the user's shell PATH. */
  env: NodeJS.ProcessEnv
  /** Windows npm installs ship `claude.cmd`, which Node can only start through a shell. */
  needsShell: boolean
}

export interface ResolveOptions {
  /** Explicit path from CS_CLAUDE_PATH. */
  override?: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  home?: string
  /** Reads PATH from the user's login shell; injectable for tests. */
  loginShellPath?: () => Promise<string | null>
  /** Usual install locations checked after PATH; injectable for tests. */
  installDirs?: string[]
}

// Apps opened from Finder/Dock don't inherit the terminal's PATH, so `claude`
// (usually in ~/.local/bin or Homebrew) would not be found. We ask the login
// shell for its PATH and also check the usual install locations.
export async function resolveClaude(opts: ResolveOptions = {}): Promise<ResolvedCommand | null> {
  const env = opts.env ?? process.env
  const platform = opts.platform ?? process.platform
  const home = opts.home ?? homedir()
  const isWindows = platform === 'win32'

  const shellPath = isWindows ? null : await (opts.loginShellPath ?? readLoginShellPath)()
  const installDirs =
    opts.installDirs ??
    (isWindows
      ? [join(home, '.local', 'bin'), join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'npm')]
      : [join(home, '.local', 'bin'), join(home, '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin'])

  const pathDirs = uniq([...splitPath(env.PATH), ...splitPath(shellPath ?? undefined), ...installDirs])
  const runEnv: NodeJS.ProcessEnv = { ...env, PATH: pathDirs.join(delimiter) }

  const found = opts.override ?? (await findInDirs(pathDirs, isWindows ? ['claude.exe', 'claude.cmd'] : ['claude']))
  if (!found || !(await isExecutable(found))) return null

  return { path: found, env: runEnv, needsShell: isWindows && found.toLowerCase().endsWith('.cmd') }
}

export function readLoginShellPath(timeoutMs = 4000): Promise<string | null> {
  const shell = process.env.SHELL || '/bin/zsh'
  return new Promise((resolve) => {
    execFile(
      shell,
      ['-ilc', 'printf "__CS_PATH__%s__CS_END__" "$PATH"'],
      { timeout: timeoutMs, env: { ...process.env, TERM: 'dumb' } },
      (_err, stdout) => {
        const match = /__CS_PATH__(.*)__CS_END__/s.exec(String(stdout ?? ''))
        resolve(match?.[1] ?? null)
      }
    )
  })
}

async function findInDirs(dirs: string[], names: string[]): Promise<string | null> {
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name)
      if (await isExecutable(candidate)) return candidate
    }
  }
  return null
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

function splitPath(value: string | undefined): string[] {
  return (value ?? '').split(delimiter).filter(Boolean)
}

function uniq(items: string[]): string[] {
  return [...new Set(items)]
}
