// Same representative calls on several models: validity, latency, cost and the text itself.
// Usage: npx tsx --tsconfig tsconfig.node.json scripts/model-compare.mts [models=claude-sonnet-5,claude-opus-5-5] [out=test-results/modeller]
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Seed } from '../src/shared/game/schema'
import { createNewGame } from '../src/engine/new-game'
import { ClaudeCliProvider } from '../src/main/ai/claude-cli'
import { resolveClaude } from '../src/main/ai/find-claude'
import { ClaudeBrain, type BrainCall, type Commitment } from '../src/main/game/claude/brain'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]))
const models = (args.models ?? 'claude-sonnet-5,claude-opus-5-5').split(',')
const out = args.out ?? 'test-results/modeller'
mkdirSync(out, { recursive: true })

const ORDERS = [
  { name: 'yaratıcı', text: 'Suriye sınırına asker yığ ve Rusya lideriyle gizli görüşme ayarla.', expect: 'action' },
  { name: 'ekonomi', text: 'Enflasyonla mücadele et ama halkı da ezme; dar gelirliye destek ver.', expect: 'action' },
  { name: 'absürt', text: 'Dünyayı fethet.', expect: 'absurd' },
  { name: 'soru', text: 'Seçimi kazanmak için ne yapmalıyız? Riskleri neler?', expect: 'talk' }
] as const

const seed: Seed = {
  id: 'sd-000001',
  plantedTurn: 1,
  wakeTurn: 4,
  originEventId: 'ev-000001',
  sourceEffectId: 'press_crackdown',
  hook: "Tur 1'de basına uygulanan baskı sessiz bir öfke biriktiriyor; muhalif gazetecilerin kapatılması üniversitelerde ve büyük şehirlerde tepkiye dönüşebilir.",
  entities: [{ type: 'country', id: 'TUR' }],
  tags: ['basin', 'protesto'],
  likelihood: 'likely',
  condition: null,
  status: 'dormant',
  firedTurn: null
}
const TURNS: Array<{ name: string; decisions: Commitment[]; seeds: Seed[] }> = [
  {
    name: 'kelebekli tur',
    decisions: [
      { effectId: 'border_deployment', target: { type: 'country', id: 'SYR' }, reason: 'Hatay ve Kilis hattına zırhlı birlikler kaydırılıyor.' },
      { effectId: 'backchannel_talks', target: { type: 'country', id: 'RUS' }, reason: 'İstihbarat başkanı Kremlin ile gizli kanal açıyor.' }
    ],
    seeds: [seed]
  },
  {
    name: 'ekonomi turu',
    decisions: [
      { effectId: 'interest_rate_hike', target: { type: 'country', id: 'TUR' }, reason: 'Merkez Bankası faizi artırıyor.' },
      { effectId: 'minimum_wage_raise', target: { type: 'country', id: 'TUR' }, reason: 'Asgari ücrete ara zam.' },
      { effectId: 'energy_deal', target: { type: 'country', id: 'AZE' }, reason: 'Azerbaycan ile uzun vadeli gaz anlaşması.' }
    ],
    seeds: []
  }
]

interface Row {
  model: string
  case: string
  seconds: number
  costUsd: number
  inputTokens: number
  outputTokens: number
  ok: boolean
  note: string
  text: string
}
const rows: Row[] = []

for (const model of models) {
  const provider = new ClaudeCliProvider({ workDir: join(tmpdir(), 'cs-compare'), model, resolveCommand: () => resolveClaude() })
  const brain = new ClaudeBrain(provider)
  const state = createNewGame({ gameId: 'karsilastirma', seed: 5 })

  for (const o of ORDERS) {
    const calls: BrainCall[] = []
    const started = Date.now()
    const r = await brain.interpret({ state, message: o.text, pending: [], recentEvents: [] }, { onCall: (c) => calls.push(c) })
    const ok =
      o.expect === 'talk'
        ? r.kind === 'talk'
        : o.expect === 'absurd'
          ? r.rejected.length > 0 && r.decisions.some((d) => d.effectId === 'reckless_gambit')
          : r.rejected.length === 0 && r.decisions.length > 0
    rows.push({
      model,
      case: o.name,
      seconds: (Date.now() - started) / 1000,
      costUsd: calls.reduce((n, c) => n + (c.costUsd ?? 0), 0),
      inputTokens: calls.reduce((n, c) => n + (c.usage ? c.usage.inputTokens + (c.usage.cacheReadTokens ?? 0) + (c.usage.cacheWriteTokens ?? 0) : 0), 0),
      outputTokens: calls.reduce((n, c) => n + (c.usage?.outputTokens ?? 0), 0),
      ok,
      note: `${r.kind}; ${r.decisions.map((d) => `${d.effectId}→${d.target.id}`).join(', ') || '-'}${r.rejected.length ? `; hakem ${r.rejected.length}× reddetti` : ''}${r.fallback ? '; YEDEK' : ''}`,
      text: r.reply
    })
    console.log(`${model} · ${o.name}: ${ok ? 'OK' : 'BEKLENMEDİK'} ${rows.at(-1)!.seconds.toFixed(1)} sn — ${rows.at(-1)!.note}`)
  }

  for (const t of TURNS) {
    const turnState = { ...createNewGame({ gameId: 'kayit-tur-2', seed: 9 }), turn: 3, date: '2026-04-01' }
    const calls: BrainCall[] = []
    const started = Date.now()
    const { resolution, fallback } = await brain.resolve(
      { state: turnState, decisions: t.decisions, orders: [], dueSeeds: t.seeds, relevantSeeds: [], recentEvents: [] },
      { onCall: (c) => calls.push(c) }
    )
    const o = resolution.outcome
    const foreign = o.events.filter((e) => e.kind === 'foreign_action').map((e) => e.title)
    rows.push({
      model,
      case: t.name,
      seconds: (Date.now() - started) / 1000,
      costUsd: calls.reduce((n, c) => n + (c.costUsd ?? 0), 0),
      inputTokens: calls.reduce((n, c) => n + (c.usage ? c.usage.inputTokens + (c.usage.cacheReadTokens ?? 0) + (c.usage.cacheWriteTokens ?? 0) : 0), 0),
      outputTokens: calls.reduce((n, c) => n + (c.usage?.outputTokens ?? 0), 0),
      ok: !fallback && resolution.attempts === 1,
      note: `hakem ${resolution.attempts}. denemede onayladı; dış hamle: ${foreign.join(' | ') || 'yok'}; yeni tohum ${o.seeds.length}; kelebek ${o.report.firedSeeds.map((f) => f.effectId).join(', ') || '-'}${fallback ? `; YEDEK: ${fallback}` : ''}`,
      text: `${o.narration.headline}\n\n${o.narration.body}`
    })
    console.log(`${model} · ${t.name}: ${rows.at(-1)!.ok ? 'OK' : 'BEKLENMEDİK'} ${rows.at(-1)!.seconds.toFixed(1)} sn — ${rows.at(-1)!.note}`)
  }
}

writeFileSync(join(out, 'karsilastirma.json'), JSON.stringify(rows, null, 2))
const md = [
  '| model | durum | geçerli | süre | maliyet (API karşılığı) | girdi → çıktı token | not |',
  '|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.model} | ${r.case} | ${r.ok ? 'evet' : 'HAYIR'} | ${r.seconds.toFixed(1)} sn | $${r.costUsd.toFixed(4)} | ${r.inputTokens} → ${r.outputTokens} | ${r.note} |`),
  '',
  ...rows.map((r) => `### ${r.model} · ${r.case}\n\n${r.text}\n`)
].join('\n')
writeFileSync(join(out, 'karsilastirma.md'), md)
for (const model of models) {
  const mine = rows.filter((r) => r.model === model)
  console.log(
    `\n${model}: geçerli ${mine.filter((r) => r.ok).length}/${mine.length}, toplam ${mine.reduce((n, r) => n + r.seconds, 0).toFixed(0)} sn, $${mine.reduce((n, r) => n + r.costUsd, 0).toFixed(3)}`
  )
}
