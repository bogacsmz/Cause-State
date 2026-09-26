// Plays the built app like a person would: reads the desk, types orders, clicks cards,
// ends turns, and saves a screenshot of every turn plus a log. The fun proof of phase 1.
// Run `npm run build` first. Linux without a display:
//   xvfb-run -a -s "-screen 0 1600x1000x24" node scripts/playthrough.mjs strategy=planli
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')))
const strategy = args.strategy ?? 'planli'
const turns = Number(args.turns ?? 20)
const outDir = args.out ?? join('test-results', `oyun-${strategy}`)
mkdirSync(outDir, { recursive: true })

const launchArgs = ['.']
if (process.platform === 'linux' && process.getuid?.() === 0) launchArgs.push('--no-sandbox')
const app = await electron.launch({
  args: launchArgs,
  env: {
    ...process.env,
    CS_AI_PROVIDER: 'mock',
    CS_SAVE_DIR: mkdtempSync(join(tmpdir(), 'cs-oyun-')),
    CS_GAME_SEED: args.seed ?? '7',
    CS_GAME_ID: args.id ?? `kanit-${strategy}`
  }
})

const log = []
const problems = []
const say = (line) => {
  console.log(line)
  log.push(line)
}

try {
  const page = await app.firstWindow()
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`))
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForSelector('.nation', { timeout: 20_000 })
  await page.waitForTimeout(500)
  const shot = (name) => page.screenshot({ path: join(outDir, name) })
  const view = () => page.evaluate(() => window.cs.game.view())
  await shot('00-baslangic.png')

  // ── how the player acts: typing an order, or clicking a card ───────────────
  const order = async (text) => {
    await page.fill('#order', text)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(150)
    const reply = await page.locator('.chat__reply').last().textContent()
    say(`  emir: "${text}" → ${reply?.replace(/^Danışman/, '').trim()}`)
  }
  const card = async (label, target) => {
    const el = page.locator('.card', { has: page.locator('.card__title', { hasText: label }) })
    if (target) await el.locator('select').selectOption({ label: target })
    await el.getByRole('button', { name: /Karar ver|Bir tane daha/ }).click()
    await page.waitForTimeout(150)
    say(`  kart: ${label}${target ? ` → ${target}` : ''}`)
  }
  const available = (v, id, target) =>
    v.options.some((o) => o.effectId === id && o.available && (!target || o.targets.some((t) => t.name === target && t.available)))

  // ── strategies ──────────────────────────────────────────────────────────────
  const play = {
    // Builds the economy early, keeps stability, spends popularity right before the vote.
    async planli(v) {
      const left = v.player.election.turnsLeft
      const bar = (id) => v.player.bars.find((b) => b.id === id).value
      if (v.turn % 4 === 1) await order('Durum nedir, ne önerirsin?')
      if (left <= 3) {
        if (available(v, 'tax_cut')) await order('Vergileri indir')
        if (available((await view()), 'anti_corruption_drive') && bar('stability') > 48) await card('Yolsuzlukla mücadele')
        if (available((await view()), 'regional_investment', 'İstanbul')) await order("İstanbul'a bölgesel yatırım yap")
        return
      }
      if (left >= 9 && available(v, 'austerity') && bar('approval') > 42) await card('Kemer sıkma')
      if (available((await view()), 'trade_agreement', 'Almanya')) await order('Almanya ile ticaret anlaşması imzala')
      if (available((await view()), 'trade_agreement', 'Çin')) await card('Ticaret anlaşması', 'Çin')
      else if (available((await view()), 'trade_agreement', 'Yunanistan')) await card('Ticaret anlaşması', 'Yunanistan')
      if (available((await view()), 'regional_investment', 'İzmir')) await order("İzmir'e yatırım yap")
      if (v.turn === 2) await order('Yunanistan hükümetine nota ver')
    },
    // Whatever pleases voters this month, every month.
    async populist(v) {
      if (v.turn % 4 === 1) await order('Durum nedir?')
      if (available(v, 'tax_cut')) await order('Vergileri indir')
      if (available((await view()), 'fiscal_stimulus')) await order('Teşvik paketi açıkla, ekonomiyi canlandır')
      if (available((await view()), 'anti_corruption_drive')) await card('Yolsuzlukla mücadele')
      if (available((await view()), 'regional_investment', 'İstanbul')) await card('Bölgesel yatırım', 'İstanbul')
    },
    // Rules by force: censorship, army, sanctions.
    async otoriter(v) {
      if (v.turn % 4 === 1) await order('Durum nedir?')
      if (available(v, 'press_crackdown')) await order('Basını sustur, muhalif gazeteleri kapat')
      if (available((await view()), 'military_buildup')) await card('Askerî yığınak')
      if (available((await view()), 'sanctions', 'Yunanistan')) await order('Yunanistan’a yaptırım uygula')
      else if (available((await view()), 'sanctions', 'Almanya')) await card('Yaptırım', 'Almanya')
    }
  }[strategy]
  if (!play) throw new Error(`unknown strategy ${strategy}`)

  const bars = (v) =>
    v.player.bars
      .filter((b) => ['approval', 'stability', 'economy', 'welfare'].includes(b.id))
      .map((b) => `${b.label} ${b.value}${b.delta ? ` (${b.delta > 0 ? '+' : ''}${b.delta})` : ''}`)
      .join(' · ')

  for (let t = 0; t < turns; t++) {
    let v = await view()
    if (v.status !== 'playing') break
    say(`\nTur ${v.turn + 1} planı — anket %${v.player.bars[0].value}, seçime ${v.player.election.turnsLeft} ay, darbe riski %${Math.round(v.player.coupRisk * 100)}`)
    await play(v)
    v = await view()
    const n = String(v.turn + 1).padStart(2, '0')
    await shot(`${n}a-plan.png`)

    await page.click('.btn--turn')
    await page.waitForFunction((turn) => document.querySelector('.calendar__turn')?.textContent === `Tur ${turn}`, v.turn + 1)
    await page.waitForTimeout(350)
    v = await view()
    const r = v.report
    say(`Tur ${v.turn} sonucu: ${bars(v)}`)
    for (const f of r.firedSeeds) say(`  ${f.source ? 'KELEBEK' : 'DÜNYA'}: ${f.effectId} — kaynağı tur ${f.plantedTurn} · ${f.origin}`)
    if (r.election) say(`  SEÇİM: oy %${r.election.vote}, baraj %${r.election.threshold} → ${r.election.won ? 'KAZANDI' : 'KAYBETTİ'}`)
    if (r.coup) say(`  UYARI: darbe riski %${Math.round(r.coup.chance * 100)} → ${r.coup.happened ? 'DARBE OLDU' : 'olmadı'}`)
    const headline = v.feed.filter((e) => e.turn === v.turn && e.kind === 'narration').at(-1)
    if (headline) say(`  manşet: ${headline.title}`)
    await shot(`${String(v.turn).padStart(2, '0')}b-sonuc.png`)
    if (v.status !== 'playing') {
      say(`\nOYUN BİTTİ: ${v.ending.title} — ${v.ending.detail}`)
      await page.waitForTimeout(300)
      await shot(`${String(v.turn).padStart(2, '0')}c-son.png`)
      break
    }
    await page.click('.sheet .btn--primary')
    await page.waitForTimeout(150)
  }
  await shot('99-masa.png')
} finally {
  await app.close()
}

writeFileSync(join(outDir, 'oyun-kaydi.txt'), log.join('\n') + '\n')
if (problems.length) {
  console.error('Sorunlar:\n' + problems.join('\n'))
  process.exit(1)
}
console.log(`\nEkran görüntüleri ve kayıt: ${outDir}/`)
