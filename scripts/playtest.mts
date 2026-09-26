// Balance harness: bots play many games through the real pipeline and we look at the numbers.
// Usage: npm run playtest [-- games=200 turns=30 trace=dengeli]
import { BOTS, formatTrace, playGame, type GameResult } from '../src/engine/playtest'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]))
const GAMES = Number(args.games ?? 200)
const TURNS = Number(args.turns ?? 30)
const TRACE = args.trace

if (TRACE) {
  const bot = BOTS[TRACE]
  if (!bot) throw new Error(`no bot "${TRACE}"; try ${Object.keys(BOTS).join(', ')}`)
  const result = await playGame(bot, { gameId: `pt-${TRACE}-0`, seed: 1000, turns: TURNS })
  console.log(formatTrace(result.trace).join('\n'))
  console.log(`son: tur ${result.endTurn}, ${result.ending ?? 'oyun sürüyor'}, oylar ${result.votes.join(' / ') || '-'}`)
  process.exit(0)
}

const pct = (n: number, d: number): string => `${Math.round((100 * n) / Math.max(1, d))}%`
const avg = (xs: number[]): string => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : '-')
const cols: Array<[string, (rs: GameResult[]) => string]> = [
  ['1.seçim', (rs) => pct(rs.filter((r) => r.electionsWon >= 1).length, rs.length)],
  ['2.seçim', (rs) => pct(rs.filter((r) => r.electionsWon >= 2).length, rs.length)],
  ['darbe', (rs) => pct(rs.filter((r) => r.ending === 'coup').length, rs.length)],
  ['ort.1.oy', (rs) => avg(rs.flatMap((r) => r.votes.slice(0, 1)))],
  ['kelebek≤15', (rs) => pct(rs.filter((r) => r.firstButterfly !== null && r.firstButterfly <= 15).length, rs.length)],
  ['ilk kelebek', (rs) => avg(rs.flatMap((r) => (r.firstButterfly === null ? [] : [r.firstButterfly])))],
  ['kelebek/oyun', (rs) => avg(rs.map((r) => r.butterflies))],
  ['dünya/oyun', (rs) => avg(rs.map((r) => r.worldEvents))],
  ['min.istikrar', (rs) => avg(rs.map((r) => r.minStability))]
]

console.log(`${GAMES} oyun × en çok ${TURNS} tur, bot başına\n`)
console.log(['bot'.padEnd(9), ...cols.map(([h]) => h.padStart(14))].join(''))
for (const [name, bot] of Object.entries(BOTS)) {
  const results: GameResult[] = []
  for (let i = 0; i < GAMES; i++) results.push(await playGame(bot, { gameId: `pt-${name}-${i}`, seed: 1000 + i, turns: TURNS }))
  console.log([name.padEnd(9), ...cols.map(([, f]) => f(results).padStart(14))].join(''))
}
