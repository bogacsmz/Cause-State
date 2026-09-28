// Core-polish proof with real Claude calls: a 20-month game through the real session (save
// file, pacing, referee), some months with orders, most without. The report is built from
// the save and its call log, so an interrupted run can be continued (devam=1) without
// replaying the months already played. Writes test-results/cila/ (kanit.md, kanit.json, the save).
// Spends subscription usage (~2 calls a month, one more when an order is typed).
//   npm run kanit:cila [-- turns=10 game=cila-2 devam=1 model=claude-opus-5-5]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAJOR_TAG, TONE_TAGS, type Tone } from '../src/shared/game/impacts'
import type { GameEvent } from '../src/shared/game/schema'
import { ClaudeCliProvider } from '../src/main/ai/claude-cli'
import { resolveClaude } from '../src/main/ai/find-claude'
import { ClaudeBrain } from '../src/main/game/claude/brain'
import { GameSession } from '../src/main/game/session'
import { GameStore } from '../src/main/store/game-store'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]))
const turns = Number(args.turns ?? 10)
const gameId = args.game ?? 'cila-1'
const out = 'test-results/cila'
const dir = join(out, 'kayit')
const save = join(dir, `oyun-${gameId}.sqlite`)
if (!args.devam) rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })

/** What the player types, by month; the other months are played without a word. */
const ORDERS: Record<number, string> = {
  1: "Enflasyonla mücadele için Merkez Bankası'na faiz artırımında elini serbest bırak, kamu harcamalarını kıs.",
  3: "Atina'ya resmî ziyaret yap, Ege'de gerginliği düşürecek bir yol haritası öner.",
  5: 'Muhalif iki televizyon kanalını kapat, sosyal medyaya sıkı denetim getir.',
  8: "Azerbaycan'la yeni bir doğalgaz anlaşması imzala.",
  10: "Diyarbakır'a büyük bir sanayi bölgesi kur, bölgeye yatırım seferberliği başlat.",
  13: 'Suriye sınırına asker yığ, sınır güvenliğini sıkılaştır.',
  15: 'Asgari ücrete ara zam yap.',
  18: "Çin'le ticaret anlaşması imzala, Çinli şirketlere yatırım kapısını aç."
}

// ── play (or continue) ──────────────────────────────────────────────────────
if (!args.devam || existsSync(save)) {
  const provider = new ClaudeCliProvider({ workDir: join(tmpdir(), 'cs-cila'), model: args.model, resolveCommand: () => resolveClaude() })
  // Elections every 48 months here, so twenty months are played through without one.
  const session = await GameSession.open(dir, { brain: new ClaudeBrain(provider), first: { gameId, seed: 7, electionEveryTurns: 48 } })
  let view = await session.view()
  while (view.turn < turns && view.status === 'playing') {
    const month = view.turn + 1
    if (ORDERS[month]) await session.command(ORDERS[month])
    const started = Date.now()
    view = await session.endTurn()
    const news = view.feed.filter((e) => e.turn === view.turn && e.kind === 'narration').at(-1)
    console.log(`Tur ${view.turn} (${Math.round((Date.now() - started) / 100) / 10} sn)${ORDERS[month] ? ' [emir]' : ''}: ${news?.title ?? ''}${view.ai.notice ? ` || NOT: ${view.ai.notice}` : ''}`)
  }
  session.close()
}

// ── the numbers, from the save and its call log ─────────────────────────────
interface Call {
  role: string
  turn: number
  attempt: number
  durationMs: number
  issues: string[]
  costUsd?: number
  error?: string
  prompt: string
  output: string
}
const log = readFileSync(join(dir, `oyun-${gameId}.log.jsonl`), 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l) as Call)
const store = GameStore.open(save)
const events = await store.feedSince(1)
const last = await store.loadLatestSnapshot()
store.close()
const played = last?.turn ?? 0

const toneOf = (e: GameEvent): Tone | null => (Object.entries(TONE_TAGS).find(([, t]) => e.tags.includes(t))?.[0] as Tone | undefined) ?? null
interface Month {
  turn: number
  order: string | null
  reply: string | null
  headline: string
  news: string
  happenings: Array<{ kind: string; title: string; summary: string; tone: Tone | null; major: boolean }>
  reactions: string[]
  seconds: number
  fallback: boolean
}
const months: Month[] = []
for (let t = 1; t <= played; t++) {
  const now = events.filter((e) => e.turn === t)
  const news = now.filter((e) => e.kind === 'narration').at(-1)
  // The world and the cabinet log the turn they read (t-1), the newsroom the turn it reports (t).
  // A month retried after an interrupted run counts from its last failed call on.
  const tried = log.filter((c) => (c.role === 'resolve' && c.turn === t - 1) || (c.role === 'narrate' && c.turn === t))
  const failed = tried.findLastIndex((c) => c.error && c.role === 'resolve')
  const world = failed >= 0 && failed < tried.length - 1 ? tried.slice(failed + 1) : tried
  const interpret = log.filter((c) => c.turn === t - 1 && c.role === 'interpret' && !c.error).at(-1)
  let reply: string | null = null
  try {
    reply = interpret ? (JSON.parse(interpret.output) as { reply: string }).reply : null
  } catch {
    reply = null
  }
  months.push({
    turn: t,
    order: ORDERS[t] ?? null,
    reply,
    headline: news?.title ?? '',
    news: news?.summary ?? '',
    happenings: now
      .filter((e) => e.kind === 'development' || e.kind === 'seed_fired')
      .map((e) => ({ kind: e.kind, title: e.title, summary: e.summary, tone: toneOf(e), major: e.tags.includes(MAJOR_TAG) })),
    reactions: now.filter((e) => e.kind === 'foreign_action').map((e) => e.summary),
    seconds: Math.round(world.reduce((n, c) => n + c.durationMs, 0) / 100) / 10,
    fallback: world.some((c) => c.error)
  })
}

const byClaude = months.filter((m) => !m.fallback)
const worldCalls = log.filter((c) => c.role === 'resolve' && !c.error)
const repairs = worldCalls.filter((c) => c.attempt > 1).length
const interpretCalls = log.filter((c) => c.role === 'interpret' && !c.error)
const draftsRejected = interpretCalls.filter((c) => c.issues.length > 0).length
const avg = (xs: number[]): number => Math.round((xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)) * 10) / 10
const all = months.flatMap((m) => m.happenings)
const tone = (t: Tone): number => all.filter((h) => h.tone === t).length
const busy = months.filter((m) => m.happenings.length > 0).length
const cost = log.reduce((n, c) => n + (c.costUsd ?? 0), 0)

const md: string[] = []
const say = (line = ''): void => {
  md.push(line)
}
say(`# Çekirdek cila kanıtı (gerçek Claude, ${turns} ay)`)
say()
say(`Oyun: ${gameId}, ${months.length} ay oynandı; ${months.filter((m) => m.order).length} ayda emir verildi, gerisi pas.`)
if (months.some((m) => m.fallback)) say(`Not: ${months.filter((m) => m.fallback).map((m) => m.turn).join(', ')}. ay(lar)da Claude'a ulaşılamadı (abonelik oturum sınırı); o aylar kurallı yedekle oynandı ve süre ortalamasına girmedi.`)
say()
say('## Olaylar ve tonları')
say(`- Dünyanın kendi gelişmesi + geri dönen kararlar: **${all.length} olay / ${months.length} ay** (ay başına ${(all.length / Math.max(1, months.length)).toFixed(2)})`)
say(`- Olaylı ay: **${busy}/${months.length}**; sakin ay: ${months.length - busy}`)
say(`- Ton: fırsat ${tone('opportunity')} · iyi ${tone('good')} · nötr ${tone('neutral')} · kriz ${tone('trouble')}; büyük olay ${all.filter((h) => h.major).length}`)
say(`- Dünyanın kendi gelişmesi: ${all.filter((h) => h.kind === 'development').length}; geri dönen karar: ${all.filter((h) => h.kind === 'seed_fired').length}`)
say(`- Başka ülkelerin tepkisi (sadece emir verilen aylarda, dokunulan ülkeden): ${months.reduce((n, m) => n + m.reactions.length, 0)}`)
say()
say('## Hakem ve süre')
say(`- Emir okuma: ${interpretCalls.length} çağrı, hakemin geri çevirdiği taslak: ${draftsRejected}`)
say(`- Dünya hamlesi: ${worldCalls.length} çağrı, onarım turu: ${repairs}`)
say(`- Tur süresi (dünya + haber çağrıları, Claude'un oynadığı aylar): ortalama ${avg(byClaude.map((m) => m.seconds))} sn, en uzun ${Math.max(0, ...byClaude.map((m) => m.seconds))} sn`)
say(`- Toplam maliyet (abonelik yolunda tahmini): $${cost.toFixed(2)}`)
say()
say('## Ay ay')
say('| Tur | Emir | Manşet | Olay | Süre |')
say('|---|---|---|---|---|')
for (const m of months) {
  const list = m.happenings.map((h) => `${h.tone ?? ''}${h.major ? ' (büyük)' : ''}: ${h.title}`).join('<br>') || 'sakin'
  say(`| ${m.turn} | ${m.order ? 'var' : '–'} | ${m.headline.replace(/\|/g, '/')} | ${list.replace(/\|/g, '/')} | ${m.fallback ? 'yedek' : `${m.seconds} sn`} |`)
}
say()
say('## Bütün haberler')
for (const m of months) {
  say()
  say(`### Tur ${m.turn}${m.order ? ` · Emir: "${m.order}"` : ' · pas'}${m.fallback ? ' · (yedek)' : ''}`)
  if (m.reply) say(`> Kabine: ${m.reply}`)
  say()
  say(`**${m.headline}**`)
  say()
  say(m.news)
  for (const h of m.happenings) say(`\n- _${h.kind === 'seed_fired' ? 'geri dönen karar' : 'gelişme'}, ${h.tone}${h.major ? ', büyük' : ''}_ — **${h.title}**: ${h.summary}`)
  for (const r of m.reactions) say(`\n- _tepki_ — ${r}`)
}
writeFileSync(join(out, 'kanit.md'), `${md.join('\n')}\n`)
writeFileSync(join(out, 'kanit.json'), JSON.stringify({ months, repairs, worldCalls: worldCalls.length, cost }, null, 2))
console.log(`\n${md.slice(0, 20).join('\n')}\n\nRapor: ${out}/kanit.md`)
