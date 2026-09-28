// Replays the next month of a save with the scripted rules and prints what the referee says (dev tool).
//   npx tsx --tsconfig tsconfig.node.json scripts/yedek-dene.mts <kayit.sqlite>
import { DEVELOPMENT_TAG } from '../src/shared/game/impacts'
import { happeningsFrom } from '../src/engine/director'
import { resolveTurn } from '../src/engine/resolve'
import { GameStore } from '../src/main/store/game-store'

const store = GameStore.open(process.argv[2]!)
const state = (await store.loadLatestSnapshot())!
const res = await resolveTurn(state, {
  decisions: [],
  orders: [],
  candidateSeeds: await store.dueSeeds(state.turn + 1),
  past: happeningsFrom(await store.eventsByTag(DEVELOPMENT_TAG, { limit: 12 }))
})
console.log('turn', state.turn + 1, 'plan', JSON.stringify({ firing: res.plan.firing.map((s) => [s.id, s.tags, s.sourceEffectId]), beat: res.plan.beat, seedScale: res.plan.seedScale }))
console.log(res.ok ? 'OK' : JSON.stringify(res.issues, null, 1))
store.close()
