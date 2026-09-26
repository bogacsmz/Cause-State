import { describe, expect, it } from 'vitest'
import { BOTS, playGame, type GameResult } from '../../src/engine/playtest'

// The fun contract, as numbers: no free wins, short-termism is punished, bad rule loses
// (sometimes to the army), planning pays, and decisions come back as butterflies.
// Bounds are loose on purpose; `npm run playtest` shows the full table.

const GAMES = 40
const results: Record<string, GameResult[]> = {}
async function games(bot: string): Promise<GameResult[]> {
  results[bot] ??= await Promise.all(
    Array.from({ length: GAMES }, (_, i) => playGame(BOTS[bot]!, { gameId: `bal-${bot}-${i}`, seed: 500 + i, turns: 26 }))
  )
  return results[bot]
}
const share = (rs: GameResult[], f: (r: GameResult) => boolean): number => rs.filter(f).length / rs.length

// Hundreds of simulated games: give them room on a busy machine (the default is 5 s per test).
describe('balance (bots through the real pipeline)', { timeout: 60_000 }, () => {
  it('doing nothing loses the first election most of the time', async () => {
    expect(share(await games('bos'), (r) => r.electionsWon >= 1)).toBeLessThan(0.25)
  })

  it('random play is worse than a plan', async () => {
    const random = share(await games('rastgele'), (r) => r.electionsWon >= 1)
    const planned = share(await games('dengeli'), (r) => r.electionsWon >= 1)
    expect(random).toBeLessThan(0.4)
    expect(planned).toBeGreaterThan(0.8)
  })

  it('populism can win once, then the bills come due', async () => {
    const rs = await games('populist')
    expect(share(rs, (r) => r.electionsWon >= 1)).toBeGreaterThan(0.25)
    expect(share(rs, (r) => r.electionsWon >= 2)).toBeLessThan(0.15)
  })

  it('ruling by force loses, by the ballot or by a coup', async () => {
    const rs = await games('otoriter')
    expect(share(rs, (r) => r.electionsWon >= 1)).toBeLessThan(0.1)
    expect(rs.some((r) => r.ending === 'coup')).toBe(true)
  })

  it('every active player sees their own decisions come back within 15 turns', async () => {
    for (const bot of ['rastgele', 'populist', 'otoriter', 'dengeli']) {
      expect(share(await games(bot), (r) => r.firstButterfly !== null && r.firstButterfly <= 15)).toBeGreaterThan(0.9)
    }
  })
})
