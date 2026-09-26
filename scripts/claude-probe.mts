// Quick live check of the Claude brain: a few orders and one turn, printed with timings.
// Usage: npx tsx --tsconfig tsconfig.node.json scripts/claude-probe.mts [model]
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EFFECTS } from '../src/shared/game/catalog'
import { createNewGame } from '../src/engine/new-game'
import { ClaudeCliProvider } from '../src/main/ai/claude-cli'
import { resolveClaude } from '../src/main/ai/find-claude'
import { ClaudeBrain, type Commitment } from '../src/main/game/claude/brain'

const model = process.argv[2]
const provider = new ClaudeCliProvider({ workDir: join(tmpdir(), 'cs-probe'), model, resolveCommand: () => resolveClaude() })
const brain = new ClaudeBrain(provider)
const state = createNewGame({ gameId: 'probe', seed: 5 })
const pending: Commitment[] = []
const calls: string[] = []
const hooks = {
  onRejected: (r: { reasons: string[]; reply: string }) => console.log(`   ✗ hakem: ${r.reasons.join(' | ')}\n     (ilk cevap: ${r.reply})`),
  onCall: (c: { role: string; attempt: number; durationMs: number; costUsd?: number; model?: string; usage?: { inputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; outputTokens: number } }) =>
    calls.push(`${c.role}#${c.attempt} ${c.model ?? ''} ${(c.durationMs / 1000).toFixed(1)}s $${(c.costUsd ?? 0).toFixed(4)} in=${(c.usage?.inputTokens ?? 0) + (c.usage?.cacheReadTokens ?? 0) + (c.usage?.cacheWriteTokens ?? 0)} out=${c.usage?.outputTokens ?? 0}`)
}

for (const message of [
  'Suriye sınırına asker yığ ve Rusya lideriyle gizli görüşme ayarla.',
  'Dünyayı fethet.',
  'Durum nedir? Vergileri indirsem ne olur?'
]) {
  const started = Date.now()
  const r = await brain.interpret({ state, message, pending, recentEvents: [] }, hooks)
  console.log(`\n> ${message}\n  [${r.kind}] ${r.reply}`)
  for (const d of r.decisions) console.log(`   ✓ ${d.effectId} → ${d.target.id}: ${d.reason}`)
  if (r.discussed.length) console.log(`   (konuşulan: ${r.discussed.map((id) => EFFECTS[id].label).join(', ')})`)
  if (r.fallback) console.log(`   YEDEK: ${r.fallback}`)
  console.log(`   ${((Date.now() - started) / 1000).toFixed(1)} sn`)
  pending.push(...r.decisions)
}

const started = Date.now()
let news = ''
const res = await brain.resolve(
  { state, decisions: pending, orders: ['Suriye sınırına asker yığ ve Rusya lideriyle gizli görüşme ayarla.'], dueSeeds: [], relevantSeeds: [], recentEvents: [] },
  { ...hooks, onNarration: (d: string) => (news += d), onPhase: (p: string) => console.log(`   … ${p}`) }
)
const { outcome } = res.resolution
console.log(`\nTUR ${outcome.newState.turn} (${((Date.now() - started) / 1000).toFixed(1)} sn)${res.fallback ? ` YEDEK: ${res.fallback}` : ''}`)
for (const e of outcome.events.filter((e) => e.kind !== 'narration')) console.log(`  ${e.kind} [${e.visibility}] ${e.title} — ${e.summary.slice(0, 160)}`)
console.log(`\n${outcome.narration.headline}\n${outcome.narration.body}`)
console.log(`\nçağrılar:\n  ${calls.join('\n  ')}`)
