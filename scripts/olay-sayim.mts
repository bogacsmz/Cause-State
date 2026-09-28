// Counts what the world brought in a saved game, month by month, and how it landed on the
// player (weight from the catalog / the code's tables). Usage: npx tsx scripts/olay-sayim.mts <kayit.sqlite>
import { DatabaseSync } from 'node:sqlite'
import { EFFECTS, type EffectId } from '../src/shared/game/catalog'
import { TONE_TAGS } from '../src/shared/game/impacts'
import { createNewGame } from '../src/engine/new-game'
import { moveWeightOn } from '../src/engine/weight'

const file = process.argv[2]!
const db = new DatabaseSync(file, { readOnly: true })
const rows = db.prepare("SELECT body FROM events WHERE visibility = 'public' ORDER BY turn, id").all() as Array<{ body: string }>
const events = rows.map((r) => JSON.parse(r.body))
const state = createNewGame({ gameId: 'sayim' })
const turns = Math.max(...events.map((e) => e.turn))
const perTurn = new Map<number, string[]>()
const counts = { olumlu: 0, notr: 0, olumsuz: 0 }
const kinds = { foreign_action: 0, seed_fired: 0, development: 0 }
for (const e of events) {
  if (!['foreign_action', 'seed_fired', 'development'].includes(e.kind)) continue
  kinds[e.kind as keyof typeof kinds]++
  let weight = 0
  const tone = Object.entries(TONE_TAGS).find(([, t]) => e.tags.includes(t))?.[0]
  if (tone) weight = tone === 'trouble' ? -3 : tone === 'neutral' ? 0 : 3
  else if (e.effectId && e.effectId !== 'improvised') {
    const actor = e.entities[0]?.id ?? 'TUR'
    const target = e.entities[1] ?? { type: 'country', id: 'TUR' }
    weight = moveWeightOn(state, e.effectId as EffectId, actor, target, 'TUR')
  }
  const label = weight > 1 ? 'olumlu' : weight < -1 ? 'olumsuz' : 'notr'
  counts[label]++
  perTurn.set(e.turn, [...(perTurn.get(e.turn) ?? []), `${label}: ${e.title}${e.effectId ? ` (${EFFECTS[e.effectId as EffectId]?.label ?? e.effectId})` : ''}`])
}
console.log(`${file}\n${turns} tur`)
for (let t = 1; t <= turns; t++) console.log(`Tur ${t}: ${(perTurn.get(t) ?? ['sakin']).join(' | ')}`)
const total = counts.olumlu + counts.notr + counts.olumsuz
const busy = [...perTurn.keys()].length
console.log({ olay: total, turBasina: +(total / turns).toFixed(2), olayliTur: `${busy}/${turns}`, ...counts, ...kinds })
