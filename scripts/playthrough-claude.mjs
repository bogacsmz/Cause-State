// Plays the built app with real Claude, like a person typing free-text orders: one to two
// messages a month for 20 months, a screenshot of every month and a readable log.
// Run `npm run build` first. Uses your Claude subscription (claude -p).
//   xvfb-run -a -s "-screen 0 1600x1000x24" node scripts/playthrough-claude.mjs [turns=20] [out=test-results/oyun-claude]
import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')))
const turns = Number(args.turns ?? 20)
const outDir = args.out ?? 'test-results/oyun-claude'
mkdirSync(outDir, { recursive: true })

// What the player types, month by month: orders in their own words, some questions, a bad
// idea or two, and one absurd order on purpose.
const SCRIPT = [
  ['Merkez Bankası faizi artırsın ama dar gelirliye asgari ücret zammı verelim.'],
  ['Azerbaycan’la uzun vadeli doğalgaz anlaşması imzala, Bakü’ye resmî ziyaret yap.'],
  ['Durum nedir? Önümüzdeki aylarda neye dikkat etmeliyiz?', 'İstanbul’da büyük bir sosyal konut seferberliği başlat.'],
  ['Yunanistan Ege’de tatbikat yapıyor; donanmayı tartışmalı sulara gönder ama savaş çıkarma.'],
  ['Suriye sınırına asker yığ ve Rusya lideriyle gizli görüşme ayarla.'],
  ['Ukrayna ile Rusya arasında arabuluculuk teklif et, İstanbul’da barış zirvesine ev sahipliği yap.'],
  ['Bizi karalayan muhalif gazeteleri kapat, sosyal medyayı da sıkılaştır.'],
  ['Yolsuzluk yapan belediye başkanlarına büyük operasyon başlat.'],
  ['Seçime ne kadar kaldı, kazanabilir miyiz?', 'Avrupa’da büyük bir turizm tanıtım kampanyası yap.'],
  ['Vergileri indir, emekliye bayram ikramiyesi ver.'],
  ['Bütün yurtta büyük milli birlik mitingleri düzenle.'],
  ['Seçimden önce kabineyi yenile, genç ve temiz isimler getir.'],
  ['Amerika’dan savaş uçağı almak için pazarlık et; karşılığında Rusya ile enerji işini yavaşlat.'],
  ['Yerli savunma sanayine büyük yatırım yap, İHA ihracatını artır.'],
  ['İsrail’e silah ambargosu uygula ve Gazze’ye insani yardım gönder.'],
  ['Durum nedir?', 'Hatay ve Gaziantep’e deprem sonrası yeniden yapım yatırımı yap.'],
  ['AB üyelik sürecini canlandırmak için yargı reformu yap ve Brüksel’e yeniden başvur.'],
  ['Dünyayı fethet.'],
  ['Çin ile Kuşak ve Yol kapsamında bir ticaret anlaşması imzala.'],
  ['Bu yılı değerlendir: neyi iyi yaptık, neyi kötü?', 'Eğitim reformunu başlat.']
]

const saveDir = mkdtempSync(join(tmpdir(), 'cs-oyun-claude-'))
const launchArgs = ['.']
if (process.platform === 'linux' && process.getuid?.() === 0) launchArgs.push('--no-sandbox')
const app = await electron.launch({
  args: launchArgs,
  env: { ...process.env, CS_AI_PROVIDER: 'cli', CS_SAVE_DIR: saveDir, CS_GAME_SEED: args.seed ?? '11', CS_GAME_ID: args.id ?? 'claude-20-tur' }
})

const log = []
const problems = []
const say = (line) => {
  console.log(line)
  log.push(line)
}
const bars = (v) =>
  v.player.bars
    .filter((b) => ['approval', 'stability', 'economy', 'welfare'].includes(b.id))
    .map((b) => `${b.label} ${b.value}${b.delta ? ` (${b.delta > 0 ? '+' : ''}${b.delta})` : ''}`)
    .join(' · ')

try {
  const page = await app.firstWindow()
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`))
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForSelector('.nation', { timeout: 20_000 })
  await page.waitForTimeout(800)
  const view = () => page.evaluate(() => window.cs.game.view())
  const shot = (name) => page.screenshot({ path: join(outDir, name) })
  await shot('00-baslangic.png')

  const ask = async (text, n, k) => {
    await page.fill('#order', text)
    await page.keyboard.press('Enter')
    await page.waitForSelector('.chat--live', { timeout: 20_000 })
    if (k === 0 && (n === 1 || n === 5 || n === 18)) {
      await page.waitForSelector('.chat--live .caret', { timeout: 120_000 }).catch(() => undefined)
      await page.waitForTimeout(1200)
      await shot(`${String(n).padStart(2, '0')}-akis.png`)
    }
    await page.waitForSelector('.chat--live', { state: 'detached', timeout: 300_000 })
    const v = await view()
    const c = v.chat.at(-1)
    say(`  > ${text}`)
    for (const r of c.rejected) say(`    ✗ hakem reddetti: ${r.reasons.join(' | ')}`)
    say(`    [${c.kind === 'talk' ? 'soru · bedava' : 'emir'}] ${c.reply}`)
    if (c.decisions.length) say(`    kararlar: ${c.decisions.join(', ')}`)
    if (c.fallback) say(`    YEDEK: ${c.fallback}`)
  }

  for (let t = 0; t < turns; t++) {
    let v = await view()
    if (v.status !== 'playing') break
    const n = v.turn + 1
    say(`\nTUR ${n} — anket %${v.player.bars[0].value}, seçime ${v.player.election.turnsLeft} ay, sermaye ${v.player.capital.left}`)
    const messages = SCRIPT[t] ?? ['Durum nedir?']
    for (const [k, text] of messages.entries()) await ask(text, n, k)
    v = await view()
    await shot(`${String(n).padStart(2, '0')}a-plan.png`)

    const started = Date.now()
    await page.click('.btn--turn')
    if (n === 1 || n === 12) {
      await page.waitForSelector('.news--live .caret', { timeout: 240_000 }).catch(() => undefined)
      await page.waitForTimeout(2500)
      await shot(`${String(n).padStart(2, '0')}b-haber-akiyor.png`)
    }
    await page.waitForFunction((turn) => document.querySelector('.calendar__turn')?.textContent === `Tur ${turn}`, n, { timeout: 400_000 })
    await page.waitForTimeout(500)
    v = await view()
    const r = v.report
    say(`  SONUÇ (${Math.round((Date.now() - started) / 1000)} sn): ${bars(v)}`)
    for (const e of v.feed.filter((e) => e.turn === n)) {
      if (e.kind === 'foreign_action') say(`    dış hamle: ${e.title} — ${e.summary}`)
      if (e.kind === 'seed_fired') say(`    ${e.origin?.butterfly === false ? 'DÜNYA' : 'KELEBEK'} (kaynak tur ${e.origin?.turn} · ${e.origin?.label}): ${e.title} — ${e.summary}`)
    }
    if (r.election) say(`    SEÇİM: oy %${r.election.vote}, baraj %${r.election.threshold} → ${r.election.won ? 'KAZANDI' : 'KAYBETTİ'}`)
    if (r.coup) say(`    darbe riski %${Math.round(r.coup.chance * 100)} → ${r.coup.happened ? 'DARBE' : 'olmadı'}`)
    const news = v.feed.filter((e) => e.turn === n && e.kind === 'narration').at(-1)
    if (news) say(`    MANŞET: ${news.title}`)
    if (v.ai.notice) say(`    NOT: ${v.ai.notice}`)
    await shot(`${String(n).padStart(2, '0')}b-rapor.png`)
    if (v.status !== 'playing') {
      say(`\nOYUN BİTTİ: ${v.ending.title} — ${v.ending.detail}`)
      await shot(`${String(n).padStart(2, '0')}c-son.png`)
      break
    }
    await page.click('.sheet .btn--primary')
    await page.waitForTimeout(200)
    if (n % 5 === 0) await shot(`${String(n).padStart(2, '0')}c-masa.png`)
  }
  await shot('99-masa.png')
} finally {
  await app.close()
}

// Keep the save and the AI call log next to the screenshots.
for (const f of readdirSync(saveDir)) copyFileSync(join(saveDir, f), join(outDir, f))
writeFileSync(join(outDir, 'oyun-kaydi.txt'), log.join('\n') + '\n')
if (problems.length) {
  console.error('Sorunlar:\n' + problems.join('\n'))
  process.exit(1)
}
console.log(`\nEkran görüntüleri, kayıt dosyası ve çağrı logu: ${outDir}/`)
