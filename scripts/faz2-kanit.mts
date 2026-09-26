// Phase 2 proof with real Claude calls. Writes test-results/faz2/kanit.md (+ kanit.json).
// Usage: npm run kanit:faz2 [-- model=claude-opus-5-5]   (spends some subscription usage)
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { EFFECTS } from '../src/shared/game/catalog'
import type { GameEvent, GameState, Seed } from '../src/shared/game/schema'
import { buildTurnRequest, turnRequestTokens } from '../src/engine/context'
import { createNewGame } from '../src/engine/new-game'
import { checkDecision, reviewChangeList } from '../src/engine/referee'
import { ClaudeCliProvider } from '../src/main/ai/claude-cli'
import { resolveClaude } from '../src/main/ai/find-claude'
import { ClaudeBrain, type BrainCall, type Commitment, type ResolveResult } from '../src/main/game/claude/brain'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]))
const out = 'test-results/faz2'
mkdirSync(out, { recursive: true })
const provider = new ClaudeCliProvider({ workDir: join(tmpdir(), 'cs-kanit'), model: args.model, resolveCommand: () => resolveClaude() })
const brain = new ClaudeBrain(provider)
const md: string[] = ['# Faz 2 kanıtı (gerçek Claude çağrıları)', '']
const json: Record<string, unknown> = {}
const say = (line = ''): void => {
  console.log(line)
  md.push(line)
}
const calls: BrainCall[] = []
const hooks = { onCall: (c: BrainCall) => calls.push(c) }
const tokensIn = (c: BrainCall): number => (c.usage ? c.usage.inputTokens + (c.usage.cacheReadTokens ?? 0) + (c.usage.cacheWriteTokens ?? 0) : 0)
const fence = (value: unknown): string => `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``
const barLines = (r: ResolveResult): string[] =>
  r.resolution.outcome.report.bars
    .filter((b) => b.after !== b.before)
    .map((b) => `- ${b.bar}: ${b.before} → ${b.after} (${b.causes.map((c) => `${c.label} ${c.delta > 0 ? '+' : ''}${c.delta}`).join(', ')})`)

// 1 ─ a creative order the catalog has no single move for
say('## 1. Sözlükte olmayan yaratıcı emir')
const start = createNewGame({ gameId: 'kanit-faz2', seed: 5 })
const creativeText = 'Suriye sınırına asker yığ ve Rusya lideriyle gizli görüşme ayarla.'
const creative = await brain.interpret({ state: start, message: creativeText, pending: [], recentEvents: [] }, hooks)
say(`Emir: "${creativeText}"`)
say(`Kabine: ${creative.reply}`)
say('Claude’un önerdiği hamleler (etki kimliği + hedef, sayı yok):')
say(fence(creative.decisions))
const checks = creative.decisions.map((d, i) => checkDecision(start, d.effectId, d.target, creative.decisions.slice(0, i)))
say(`Hakem: ${checks.every((c) => c.length === 0) ? 'hepsi KABUL' : `RED: ${JSON.stringify(checks)}`}`)
const month = await brain.resolve(
  { state: start, decisions: creative.decisions, orders: [creativeText], dueSeeds: [], relevantSeeds: [], recentEvents: [] },
  hooks
)
say(`Ayın tam ChangeList'i (hakem ${month.resolution.attempts}. denemede onayladı${month.fallback ? `, YEDEK: ${month.fallback}` : ''}):`)
say(fence(month.resolution.changes))
say(`Hakem tekrar kontrol: ${reviewChangeList(month.resolution.changes, start).ok ? 'KABUL' : 'RED'}`)
say('Rakamları kod hesapladı (katalog):')
for (const line of barLines(month)) say(line)
say(`Haber: **${month.resolution.outcome.narration.headline}**`)
say(month.resolution.outcome.narration.body)
json.creative = { reply: creative.reply, decisions: creative.decisions, changes: month.resolution.changes, report: month.resolution.outcome.report }

// 2 ─ an absurd order
say()
say('## 2. Absürt emir')
const absurdText = 'Dünyayı fethet.'
const absurd = await brain.interpret({ state: start, message: absurdText, pending: [], recentEvents: [] }, hooks)
say(`Emir: "${absurdText}"`)
for (const r of absurd.rejected) {
  say(`İlk öneri: ${r.decisions.map((d) => `${d.effectId} → ${d.target.id}`).join(', ')}`)
  say(`Hakem REDDETTİ: ${r.reasons.join(' | ')}`)
}
say(`Son cevap: ${absurd.reply}`)
say(`Son karar: ${absurd.decisions.map((d) => `${EFFECTS[d.effectId].label} (${d.effectId})`).join(', ')}`)
json.absurd = absurd

// 3 ─ a free question
say()
say('## 3. "Durum nedir?" bedava')
const before = structuredClone(start)
const talk = await brain.interpret({ state: start, message: 'Durum nedir?', pending: [], recentEvents: [] }, hooks)
say(`Cevap (${talk.kind}): ${talk.reply}`)
say(`Karar: ${talk.decisions.length} · sermaye önce ${before.politicalCapital.current}, sonra ${start.politicalCapital.current} · durum değişti mi: ${isDeepStrictEqual(before, start) ? 'hayır' : 'EVET'}`)
json.talk = talk

// 4 ─ another country moves on its own
say()
say('## 4. Diğer ülkeler kendiliğinden hamle yapıyor')
let state: GameState = createNewGame({ gameId: 'kanit-dunya', seed: 21 })
const events: GameEvent[] = []
let foreignFound = false
for (let i = 0; i < 4 && !foreignFound; i++) {
  const r = await brain.resolve({ state, decisions: [], orders: [], dueSeeds: [], relevantSeeds: [], recentEvents: events }, hooks)
  const o = r.resolution.outcome
  const foreign = o.events.filter((e) => e.kind === 'foreign_action')
  say(`Tur ${o.newState.turn} (oyuncu hiçbir şey yapmadı): ${foreign.length ? foreign.map((e) => `${e.title} — ${e.summary}`).join(' | ') : 'dış hamle yok'}`)
  if (foreign.length) {
    foreignFound = true
    for (const line of barLines(r)) say(line)
    say(`Haber: **${o.narration.headline}**`)
    say(o.narration.body)
    json.foreign = { events: foreign, report: o.report, narration: o.narration }
  }
  events.push(...o.events)
  state = o.newState
}

// 5 ─ the same month twice
say()
say('## 5. Aynı senaryo iki kez')
const same: Commitment[] = [
  { effectId: 'tax_cut', target: { type: 'country', id: 'TUR' }, reason: 'Gelir vergisi dilimleri genişletiliyor.' },
  { effectId: 'state_visit', target: { type: 'country', id: 'DEU' }, reason: 'Berlin’e resmî ziyaret.' }
]
const twice: ResolveResult[] = []
for (let i = 0; i < 2; i++) {
  twice.push(await brain.resolve({ state: start, decisions: same, orders: [], dueSeeds: [], relevantSeeds: [], recentEvents: [] }, hooks))
}
const words = (t: string): Set<string> => new Set(t.toLocaleLowerCase('tr').split(/[^\p{L}]+/u).filter((w) => w.length > 3))
const [a, b] = twice.map((r) => r.resolution.outcome)
const wa = words(a!.narration.body)
const wb = words(b!.narration.body)
const jaccard = [...wa].filter((w) => wb.has(w)).length / new Set([...wa, ...wb]).size
for (const [i, o] of [a!, b!].entries()) {
  say(`${i + 1}. deneme: **${o.narration.headline}**`)
  say(`   dış hamle: ${o.events.filter((e) => e.kind === 'foreign_action').map((e) => e.title).join(', ') || 'yok'} · tohumlar: ${o.seeds.map((s) => s.hook.slice(0, 80)).join(' / ')}`)
}
say(`Aynı rakamlar (kod): ${isDeepStrictEqual(a!.report.bars.filter((x) => !x.causes.some((c) => c.kind === 'noise')).map((x) => x.causes.filter((c) => c.kind === 'effect')), b!.report.bars.filter((x) => !x.causes.some((c) => c.kind === 'noise')).map((x) => x.causes.filter((c) => c.kind === 'effect'))) ? 'evet' : 'etkiler aynı, dış hamleler farklı'} · haber metinleri kelime örtüşmesi: %${Math.round(jaccard * 100)}`)
json.variety = { headlines: [a!.narration.headline, b!.narration.headline], jaccard }

// 6 ─ a butterfly comes back
say()
say('## 6. Kelebek patlıyor (Claude’un anlatısıyla)')
const turnState = { ...createNewGame({ gameId: 'kayit-tur-2', seed: 9 }), turn: 3, date: '2026-04-01' }
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
const fly = await brain.resolve({ state: turnState, decisions: [], orders: [], dueSeeds: [seed], relevantSeeds: [], recentEvents: [] }, hooks)
const fired = fly.resolution.outcome.events.find((e) => e.kind === 'seed_fired')
say(`Tohum (kod ${seed.plantedTurn}. turda ekti, ${seed.wakeTurn}. turda patlattı): ${seed.hook}`)
say(`Claude’un seçtiği sonuç: ${fired?.title} — ${fired?.summary}`)
for (const line of barLines(fly)) say(line)
say(`Haber: **${fly.resolution.outcome.narration.headline}**`)
say(fly.resolution.outcome.narration.body)
json.butterfly = { fired, narration: fly.resolution.outcome.narration }

// 7 ─ bounded context, measured on real calls
say()
say('## 7. Bağlam boyutu: tur 5, 50 ve 500 (gerçek çağrı)')
function history(turns: number): { events: GameEvent[]; seeds: Seed[] } {
  const countries = ['GRC', 'USA', 'RUS', 'DEU', 'FRA', 'IRN', 'CHN', 'SYR', 'AZE']
  const events: GameEvent[] = []
  const seeds: Seed[] = []
  for (let t = 1; t <= turns; t++) {
    for (let k = 0; k < 10; k++) {
      const other = countries[(t + k) % countries.length]!
      events.push({
        id: `ev-${String(t * 10 + k).padStart(6, '0')}`,
        turn: t,
        date: '2026-01-01',
        kind: k === 0 ? 'narration' : 'foreign_action',
        visibility: 'public',
        title: `Tur ${t}: ${other} ile gelişme ${k}`,
        summary: 'Uzun bir haber özeti, ayrıntılarıyla. '.repeat(12),
        entities: [{ type: 'country', id: 'TUR' }, { type: 'country', id: other }],
        tags: ['diplomasi'],
        causeId: null
      })
    }
    if (t % 3 === 0) {
      seeds.push({
        id: `sd-${String(t).padStart(6, '0')}`,
        plantedTurn: t,
        wakeTurn: t + 30,
        originEventId: `ev-${String(t * 10).padStart(6, '0')}`,
        sourceEffectId: null,
        hook: 'Bu gelişme ileride geri dönebilir, bölgedeki dengeleri değiştirebilir. '.repeat(3),
        entities: [{ type: 'country', id: countries[t % countries.length]! }],
        tags: ['kelebek'],
        likelihood: 'possible',
        condition: null,
        status: 'dormant',
        firedTurn: null
      })
    }
  }
  return { events, seeds }
}
const sizes: Array<{ turn: number; events: number; estimate: number; input: number; cached: number }> = []
for (const turn of [5, 50, 500]) {
  const h = history(turn)
  const s = { ...createNewGame({ gameId: `baglam-${turn}`, seed: 1 }), turn }
  const estimate = turnRequestTokens(buildTurnRequest({ state: s, order: '', recentEvents: h.events, candidateSeeds: h.seeds }))
  const before = calls.length
  await brain.resolve({ state: s, decisions: [], orders: [], dueSeeds: [], relevantSeeds: h.seeds, recentEvents: h.events }, hooks)
  const call = calls.slice(before).find((c) => c.role === 'resolve')!
  sizes.push({ turn, events: h.events.length, estimate, input: tokensIn(call), cached: call.usage?.cacheReadTokens ?? 0 })
  say(`tur ${String(turn).padStart(3)}: kayıtta ${h.events.length} olay → istek ~${estimate} token (tahmin) · Claude’a giden toplam girdi ${tokensIn(call)} token (${call.usage?.cacheReadTokens ?? 0} önbellekten)`)
}
const spread = (Math.max(...sizes.map((x) => x.input)) - Math.min(...sizes.map((x) => x.input))) / Math.min(...sizes.map((x) => x.input))
say(`Tur 5 ile tur 500 arasındaki fark: %${Math.round(spread * 100)} (olay sayısı 100 kat arttı)`)
json.context = sizes

// cost
say()
say('## Çağrılar')
const byRole = new Map<string, BrainCall[]>()
for (const c of calls.filter((c) => c.durationMs > 0)) byRole.set(c.role, [...(byRole.get(c.role) ?? []), c])
for (const [role, list] of byRole) {
  const avg = list.reduce((n, c) => n + c.durationMs, 0) / list.length / 1000
  say(`- ${role}: ${list.length} çağrı, ortalama ${avg.toFixed(1)} sn, toplam $${list.reduce((n, c) => n + (c.costUsd ?? 0), 0).toFixed(3)} (API karşılığı; abonelikte ayrıca ödenmez) · model ${list[0]?.model}`)
}
writeFileSync(join(out, 'kanit.md'), md.join('\n'))
writeFileSync(join(out, 'kanit.json'), JSON.stringify(json, null, 2))
