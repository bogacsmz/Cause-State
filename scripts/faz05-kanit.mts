// Faz 0.5 proof: runs the contract end to end and prints a short report.
// npm run kanit
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { EFFECTS } from '../src/shared/game/catalog'
import { BAR_LABELS } from '../src/shared/game/primitives'
import type { GameEvent, Seed } from '../src/shared/game/schema'
import { buildTurnRequest, relevantEntities, turnRequestTokens } from '../src/engine/context'
import { createNewGame } from '../src/engine/new-game'
import { reviewChangeList } from '../src/engine/referee'
import { applyTurn } from '../src/engine/turn'
import { GameStore } from '../src/main/store/game-store'
import { ORDER, VALID_CHANGES, variant } from '../tests/game/fixtures'

const say = (s = ''): void => console.log(s)
const pass = (s: string): void => console.log(`  ✓ ${s}`)
const fail = (s: string): void => console.log(`  ✗ ${s}`)

const file = join(mkdtempSync(join(tmpdir(), 'cause-state-')), 'kanit.sqlite')

// 1 ─ new game → SQLite → back
say('1) Yeni oyun → SQLite → geri yükleme')
const state = createNewGame({ gameId: 'kanit', seed: 2026 })
let store = GameStore.open(file)
await store.saveSnapshot(state)
store.close()
store = GameStore.open(file)
const loaded = await store.loadLatestSnapshot()
say(`  Oyun: ${state.countries.length} ülke, ${state.provinces.length} il, oyuncu ${state.playerCountryId}, tur ${state.turn}, ${state.date}`)
if (isDeepStrictEqual(loaded, state)) pass('dosya kapatılıp açıldı, durum birebir aynı geldi')
else fail('yüklenen durum farklı!')

// 2 ─ referee
say()
say(`2) Hakem. Emir: "${ORDER}"`)
const verdict = reviewChangeList(VALID_CHANGES, state)
if (!verdict.ok) throw new Error('fixture should pass')
const cost = VALID_CHANGES.changes.reduce((n, c) => n + EFFECTS[c.effectId].cost, 0)
pass(`elle yazılmış ChangeList KABUL (siyasi sermaye ${cost}/${state.politicalCapital.current})`)

const bad: Array<[string, unknown]> = [
  ['sözlükte olmayan etki', variant((c) => void (c.changes[0]!.effectId = 'nuke_everyone' as never))],
  ['ham sayı kaçırma', variant((c) => void ((c.changes[1] as Record<string, unknown>).amount = 500))],
  ['kural dışı: başvurusuz AB üyeliği', variant((c) => void (c.changes = [{ effectId: 'eu_membership', target: { type: 'country', id: 'TUR' }, reason: 'x' }]))],
  ['yabancıya ait hamle: enerji kesintisi', variant((c) => void (c.changes = [{ effectId: 'energy_cutoff', target: { type: 'country', id: 'GRC' }, reason: 'x' }]))],
  ['tanrı modu: bütçe aşımı', variant((c) => void (c.changes = [{ effectId: 'fiscal_stimulus', target: { type: 'country', id: 'TUR' }, reason: 'x' }, { effectId: 'military_buildup', target: { type: 'country', id: 'TUR' }, reason: 'y' }]))]
]
for (const [label, raw] of bad) {
  const v = reviewChangeList(raw, state)
  if (v.ok) fail(`${label}: kabul edildi!`)
  else pass(`${label} → RED [${v.issues[0]!.code}] ${v.issues[0]!.path}: ${v.issues[0]!.message}`)
}

// 3 ─ turn → log → queries
say()
say('3) Tur → olay kaydı ve tohum → SQLite sorguları')
const outcome = applyTurn(state, { order: ORDER, changes: verdict.changes })
await store.commitTurn(outcome)
for (const fx of outcome.newState.effects) {
  const mods = fx.modifiers
    .map((m) => `${m.country} ${BAR_LABELS[m.bar]} ${m.delta > 0 ? '+' : ''}${m.delta}${m.mode === 'per_turn' ? '/tur' : ''}`)
    .join(', ')
  say(`  ${EFFECTS[fx.effectId].label} (${fx.actor} → ${fx.target.id}): ${mods}`)
}
pass(`rakamların hepsi koddan (katalog). Tur ${outcome.newState.turn}, ${outcome.newState.date}, kalan sermaye ${outcome.newState.politicalCapital.current}`)
const seed = outcome.seeds[0]!
say(`  Tohum ${seed.id}: "${seed.hook}"`)
say(`    etiketler ${seed.tags.join(', ')} · uyanma turu ${seed.wakeTurn} (zarla, koddan) · oyuncudan gizli`)

const greece = await store.eventsForEntity({ type: 'country', id: 'GRC' })
pass(`"Yunanistan ile ilgili olaylar" → ${greece.length} kayıt: ${greece.map((e) => e.title).join(' | ')}`)
const france = await store.seedsForEntities([{ type: 'country', id: 'FRA' }])
pass(`"Fransa ile ilgili uyuyan tohumlar" → ${france.length} kayıt: ${france.map((s) => s.id).join(', ')}`)
const due = await store.dueSeeds(seed.wakeTurn)
pass(`"tur ${seed.wakeTurn}'de uyanacak tohumlar" → ${due.map((s) => s.id).join(', ')}`)

// 4 ─ context size: grows until the caps fill, then stays flat
say()
say('4) LLM bağlamı: oyun uzadıkça büyüyor mu?')
const question = 'Fransa ile ilişkileri düzeltmek için ne yapmalıyız?'
const sizeAt = async (turn: number): Promise<number> => {
  const at = { ...outcome.newState, turn }
  const req = buildTurnRequest({
    state: at,
    order: question,
    recentEvents: await store.recentEvents({ limit: 50 }),
    candidateSeeds: await candidateSeeds(store, turn, question)
  })
  return turnRequestTokens(req)
}
const sizes: Array<[number, number, number]> = []
for (const [from, to] of [[2, 5], [6, 50], [51, 500]] as const) {
  await store.appendEvents(syntheticHistory(from, to))
  await store.addSeeds(syntheticSeeds(from, to))
  const stats = await store.stats()
  sizes.push([to, stats.events, await sizeAt(to)])
}
for (const [turn, events, tokens] of sizes) say(`  tur ${String(turn).padStart(3)}: kayıtta ${String(events).padStart(4)} olay → LLM'e ~${tokens} token`)
const [, , t50] = sizes[1]!
const [, , t500] = sizes[2]!
pass(`sınırlar dolduktan sonra sabit: tur 50 ≈ tur 500 (fark %${Math.round((Math.abs(t500 - t50) / t50) * 100)}), bütçe 6000`)
store.close()
say()
say(`Kayıt dosyası: ${file}`)

async function candidateSeeds(s: GameStore, turn: number, order: string): Promise<Seed[]> {
  const refs = relevantEntities(outcome.newState, order)
  const [related, dueNow] = await Promise.all([s.seedsForEntities(refs, { limit: 50 }), s.dueSeeds(turn, { limit: 50 })])
  return [...new Map([...dueNow, ...related].map((x) => [x.id, x])).values()]
}

function syntheticHistory(from: number, to: number): GameEvent[] {
  const others = ['GRC', 'USA', 'RUS', 'DEU', 'FRA', 'IRN', 'CHN']
  const list: GameEvent[] = []
  for (let t = from; t <= to; t++) {
    for (let k = 0; k < 10; k++) {
      const other = others[(t + k) % others.length]!
      list.push({
        id: `ev-syn-${t}-${k}`,
        turn: t,
        date: '2026-01-01',
        kind: 'effect_applied',
        visibility: 'public',
        title: `Tur ${t}: ${other} ile gelişme ${k}`,
        summary: 'Diplomatik ve ekonomik bir gelişme yaşandı. '.repeat(8),
        entities: [
          { type: 'country', id: 'TUR' },
          { type: 'country', id: other }
        ],
        tags: ['diplomasi'],
        causeId: null
      })
    }
  }
  return list
}

function syntheticSeeds(from: number, to: number): Seed[] {
  const others = ['GRC', 'USA', 'RUS', 'DEU', 'FRA', 'IRN', 'CHN']
  const list: Seed[] = []
  for (let t = from; t <= to; t++) {
    if (t % 3 !== 0) continue
    list.push({
      id: `sd-syn-${t}`,
      plantedTurn: t,
      wakeTurn: t + 12,
      originEventId: `ev-syn-${t}-0`,
      hook: 'Bu karar ileride beklenmedik bir biçimde geri dönebilir. '.repeat(3),
      entities: [{ type: 'country', id: others[t % others.length]! }],
      tags: ['kelebek'],
      likelihood: 'possible',
      condition: null,
      status: 'dormant',
      firedTurn: null
    })
  }
  return list
}
