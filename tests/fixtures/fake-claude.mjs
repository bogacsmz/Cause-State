#!/usr/bin/env node
// Stand-in for the `claude` CLI in tests. Behaviour is picked with FAKE_CLAUDE_MODE.
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
if (args.includes('--version')) {
  console.log('2.1.283 (Claude Code)')
  process.exit(0)
}

const mode = process.env.FAKE_CLAUDE_MODE ?? 'ok'
const out = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')
const stdin = readFileSync(0, 'utf8')
const flag = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}

out({ type: 'system', subtype: 'init', model: 'claude-test-model', session_id: 's1' })

if (mode === 'crash') {
  process.stderr.write('error: unknown option --frobnicate\n')
  process.exit(2)
}

if (mode === 'error') {
  out({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' })
  process.exit(1)
}

if (mode === 'echo') {
  const report = {
    prompt: stdin,
    system: readFileSync(flag('--system-prompt-file'), 'utf8'),
    tools: flag('--tools'),
    settingSources: flag('--setting-sources'),
    model: flag('--model') ?? null,
    hasApiKey: 'ANTHROPIC_API_KEY' in process.env,
    hasAuthToken: 'ANTHROPIC_AUTH_TOKEN' in process.env,
    nested: 'CLAUDECODE' in process.env
  }
  out({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(report) })
  process.exit(0)
}

const pieces = mode === 'slow' ? Array.from({ length: 200 }, () => 'yavaş ') : ['Merhaba ', 'Sayın ', 'Başkan.']
const delay = mode === 'slow' ? 25 : 0
const delta = (text) => ({
  type: 'stream_event',
  event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }
})

out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } } })
for (const piece of pieces) {
  out(delta(piece))
  if (delay) await new Promise((r) => setTimeout(r, delay))
}
out({ type: 'assistant', message: { content: [{ type: 'text', text: pieces.join('') }] } })
out({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: pieces.join(''),
  total_cost_usd: 0.0123,
  duration_ms: 842,
  usage: { input_tokens: 120, output_tokens: 9, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 }
})
