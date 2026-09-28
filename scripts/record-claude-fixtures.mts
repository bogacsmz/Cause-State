// Records real Claude answers for the offline tests (tests/fixtures/claude/*.jsonl).
// Spends a little subscription usage. Usage: npm run record:claude [-- model=claude-opus-5-5]
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GameState, Seed } from '../src/shared/game/schema'
import { createNewGame } from '../src/engine/new-game'
import { planMonth } from '../src/engine/director'
import { hashRoll } from '../src/engine/rng'
import { FIRE_CHANCE } from '../src/engine/seeds'
import { ClaudeCliProvider } from '../src/main/ai/claude-cli'
import { resolveClaude } from '../src/main/ai/find-claude'
import { RecordingProvider } from '../src/main/ai/recording'
import { ClaudeBrain, type Commitment } from '../src/main/game/claude/brain'
import { GameSession } from '../src/main/game/session'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]))
const dir = 'tests/fixtures/claude'
const cli = new ClaudeCliProvider({ workDir: join(tmpdir(), 'cs-record'), model: args.model, resolveCommand: () => resolveClaude() })

function brainFor(name: string): ClaudeBrain {
  const file = join(dir, `${name}.jsonl`)
  rmSync(file, { force: true })
  return new ClaudeBrain(new RecordingProvider(cli, file))
}

export const CREATIVE = 'Suriye sınırına asker yığ ve Rusya lideriyle gizli görüşme ayarla.'
export const ABSURD = 'Dünyayı fethet.'
export const TALK = 'Durum nedir? Vergileri indirsem ne olur?'

const state = createNewGame({ gameId: 'kayit', seed: 5 })

// 1–3: reading orders
const creative = await brainFor('creative').interpret({ state, message: CREATIVE, pending: [], recentEvents: [] })
console.log('creative:', creative.decisions.map((d) => `${d.effectId}→${d.target.id}`))
const absurd = await brainFor('absurd').interpret({ state, message: ABSURD, pending: [], recentEvents: [] })
console.log('absurd:', absurd.rejected.length, 'rejected →', absurd.decisions.map((d) => d.effectId))
if (absurd.rejected.length === 0) throw new Error('the absurd order was not rejected first; record again')
const talk = await brainFor('talk').interpret({ state, message: TALK, pending: [], recentEvents: [] })
console.log('talk:', talk.kind, talk.discussed)

// 4: a month with a butterfly coming due (a crackdown three months ago)
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
if (hashRoll(`${turnState.gameId}|${seed.id}|4`) >= FIRE_CHANCE.likely) throw new Error('pick a game id where the seed fires')
const decisions: Commitment[] = creative.decisions
const month = await brainFor('turn').resolve({ state: turnState, decisions, orders: [CREATIVE], dueSeeds: [seed], relevantSeeds: [], recentEvents: [] })
console.log('turn:', month.fallback ?? 'ok', month.resolution.outcome.report.firedSeeds, month.resolution.outcome.narration.headline)

// 5: a quiet month in which the world brings a development of its own (the director planned one)
export const DEVELOPMENT_GAME = 'kayit-gelisme'
const quiet = createNewGame({ gameId: DEVELOPMENT_GAME, seed: 12 })
export const DEVELOPMENT_TURN = firstBeatTurn(quiet)
const developmentMonth = await brainFor('development').resolve({
  state: { ...quiet, turn: DEVELOPMENT_TURN },
  decisions: [],
  orders: [],
  dueSeeds: [],
  relevantSeeds: [],
  recentEvents: []
})
console.log(
  'development:',
  developmentMonth.fallback ?? 'ok',
  developmentMonth.resolution.plan.beat,
  developmentMonth.resolution.outcome.events.find((e) => e.kind === 'development')?.title
)

// 6: a whole session through the main-process API
const saves = mkdtempSync(join(tmpdir(), 'cs-record-session-'))
const session = await GameSession.open(saves, { brain: brainFor('session'), first: { gameId: 'kayit-oturum', seed: 3 } })
await session.command(CREATIVE)
await session.command('Şu an seçimi kazanır mıyız?')
const view = await session.endTurn()
console.log('session:', view.turn, view.feed.filter((e) => e.kind === 'narration').at(-1)?.title)
session.close()

/** The first month in which the director plans a development with no history (keep in step with the test). */
function firstBeatTurn(state: GameState): number {
  for (let turn = 0; turn < 50; turn++) if (planMonth({ ...state, turn }, [], []).beat?.tone === 'opportunity') return turn
  throw new Error('no opportunity month found')
}
