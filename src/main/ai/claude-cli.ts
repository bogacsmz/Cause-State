import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { AiResult, AiStatus } from '@shared/ipc'
import { parseCliLine } from './claude-cli-stream'
import type { ResolvedCommand } from './find-claude'
import { abortError, LlmError, type LlmProvider, type LlmRequest } from './types'

export interface CliProviderOptions {
  /** Finds the `claude` executable; injectable so tests can point at a fake CLI. */
  resolveCommand: () => Promise<ResolvedCommand | null>
  /** Empty scratch directory the CLI runs in, so no project CLAUDE.md or hooks get picked up. */
  workDir: string
  model?: string
}

const NOT_FOUND =
  'claude komutu bulunamadı. Claude Code kurulu ve giriş yapılmış olmalı (terminalde `claude` yazarak kontrol et).'

/**
 * Runs Claude through the official Claude Code CLI (`claude -p`), which uses the
 * player's own Claude subscription on their own machine.
 */
export class ClaudeCliProvider implements LlmProvider {
  readonly id = 'cli' as const
  private command: Promise<ResolvedCommand | null> | undefined

  constructor(private readonly opts: CliProviderOptions) {}

  async status(): Promise<AiStatus> {
    const cmd = await this.resolve(true)
    if (!cmd) return { provider: 'cli', ready: false, label: 'Claude bulunamadı', detail: NOT_FOUND }

    try {
      const version = await runVersion(cmd)
      const model = this.opts.model ? ` · ${this.opts.model}` : ''
      return { provider: 'cli', ready: true, label: 'Claude · abonelik', detail: `Claude Code ${version}${model}` }
    } catch (err) {
      return {
        provider: 'cli',
        ready: false,
        label: 'Claude çalışmıyor',
        detail: `claude --version başarısız: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  async generate(req: LlmRequest): Promise<AiResult> {
    const cmd = await this.resolve(false)
    if (!cmd) throw new LlmError(NOT_FOUND)
    if (req.signal?.aborted) throw abortError()

    const started = Date.now()
    const systemFile = await this.writeSystemPrompt(req.system)
    const args = buildCliArgs({ systemFile, model: req.model ?? this.opts.model, schema: req.schema, effort: req.effort })

    const child = spawn(cmd.path, cmd.needsShell ? args.map(quoteForCmd) : args, {
      cwd: this.opts.workDir,
      env: subscriptionEnv(cmd.env),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: cmd.needsShell,
      windowsHide: true
    })

    const onAbort = (): void => {
      child.kill()
    }
    req.signal?.addEventListener('abort', onAbort, { once: true })

    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 8000) stderr += chunk
    })

    const exited = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
    // Awaited below; this only keeps a spawn error from counting as unhandled meanwhile.
    exited.catch(() => undefined)

    // The prompt goes in through stdin: no shell quoting and no argument length limits.
    child.stdin.on('error', () => {})
    child.stdin.end(req.prompt)

    let streamed = ''
    let streamedJson = ''
    let model: string | undefined
    let result: Extract<ReturnType<typeof parseCliLine>, { kind: 'result' }> | undefined

    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    for await (const line of lines) {
      const event = parseCliLine(line)
      if (event.kind === 'text') {
        // With a schema the answer is the JSON document; stray text around it is not part of it.
        if (req.schema) continue
        streamed += event.text
        req.onText?.(event.text)
      } else if (event.kind === 'json') {
        streamedJson += event.text
        req.onText?.(event.text)
      } else if (event.kind === 'model') {
        model = event.model
      } else if (event.kind === 'result') {
        result = event
      }
    }

    let exitCode: number | null
    try {
      exitCode = await exited
    } catch (err) {
      throw new LlmError(`claude başlatılamadı: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
    } finally {
      req.signal?.removeEventListener('abort', onAbort)
    }

    if (req.signal?.aborted) throw abortError()

    if (result?.ok) {
      const text = result.text || (req.schema ? streamedJson : streamed)
      // Without partial messages (older CLI) nothing streamed; deliver the whole answer at once.
      if (!(req.schema ? streamedJson : streamed) && text) req.onText?.(text)
      return {
        text,
        model,
        usage: result.usage,
        costUsd: result.costUsd,
        billing: 'subscription',
        durationMs: result.durationMs ?? Date.now() - started
      }
    }

    const reason = result?.text || stderr.trim() || `claude ${exitCode ?? '?'} koduyla kapandı`
    throw new LlmError(explainCliFailure(reason))
  }

  private resolve(fresh: boolean): Promise<ResolvedCommand | null> {
    // status() re-resolves so installing Claude Code while the game is open is picked up.
    if (fresh || !this.command) this.command = this.opts.resolveCommand()
    return this.command
  }

  private async writeSystemPrompt(system: string): Promise<string> {
    // Named by content hash so concurrent calls with different prompts never clobber each other.
    // Rewritten every call because the OS may clean the temp directory while the game runs.
    const hash = createHash('sha256').update(system).digest('hex').slice(0, 16)
    const file = join(this.opts.workDir, `system-${hash}.md`)
    await mkdir(this.opts.workDir, { recursive: true })
    await writeFile(file, system, { encoding: 'utf8', flag: 'w' })
    return file
  }
}

export function buildCliArgs(opts: {
  systemFile: string
  model?: string
  schema?: Record<string, unknown>
  effort?: string
}): string[] {
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--system-prompt-file',
    opts.systemFile,
    // The game does its own world logic: no file/bash tools, no user hooks or MCP servers,
    // and no entries in the player's Claude Code session history.
    '--tools',
    '',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
    ...(opts.model ? ['--model', opts.model] : []),
    ...(opts.effort ? ['--effort', opts.effort] : []),
    // Structured output: the CLI makes Claude answer with a document that matches the schema.
    ...(opts.schema ? ['--json-schema', JSON.stringify(opts.schema)] : [])
  ]
}

// Variables that would make the CLI bill an API key instead of the subscription,
// or make it think it is nested inside another Claude Code session.
const STRIPPED_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION'
]

export function subscriptionEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base }
  for (const key of STRIPPED_ENV) delete env[key]
  return env
}

export function explainCliFailure(raw: string): string {
  const msg = raw.trim()
  if (/unknown option|unknown argument/i.test(msg)) {
    return 'Claude Code sürümün bu oyunun kullandığı seçenekleri tanımıyor. Terminalde `claude update` çalıştır.'
  }
  if (/not logged in|please run \/login|log in|authenticat|oauth|invalid api key/i.test(msg)) {
    return 'Claude Code giriş yapılmamış görünüyor. Terminalde `claude` yazıp /login ile giriş yap.'
  }
  if (/usage limit|limit reached|rate limit|quota/i.test(msg)) {
    return 'Abonelik kullanım limitine ulaşıldı. Limit sıfırlanınca tekrar dene ya da API anahtarına geç.'
  }
  const short = msg.length > 300 ? `${msg.slice(0, 299)}…` : msg
  return `Claude Code hata verdi: ${short}`
}

function runVersion(cmd: ResolvedCommand): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd.path,
      ['--version'],
      { env: subscriptionEnv(cmd.env), timeout: 15000, shell: cmd.needsShell, windowsHide: true },
      (err, stdout) => {
        if (err) reject(err)
        else resolve(String(stdout).trim().split('\n')[0]?.replace(/\s*\(Claude Code\)\s*$/, '') ?? '')
      }
    )
  })
}

function quoteForCmd(arg: string): string {
  return `"${arg.replace(/"/g, '""')}"`
}
