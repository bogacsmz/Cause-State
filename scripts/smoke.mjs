// Smoke test: launches the built app, plays one turn through the UI, and saves screenshots.
// Run `npm run build` first. Uses a throwaway save folder, never your real saves.
// Linux without a display: xvfb-run -a -s "-screen 0 1600x1000x24" npm run smoke
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

const outDir = process.env.SMOKE_OUT ?? 'test-results'
mkdirSync(outDir, { recursive: true })
const shot = (page, name) => page.screenshot({ path: join(outDir, name) })

const args = ['.']
// Chromium refuses to run as root without this; only relevant in CI containers.
if (process.platform === 'linux' && process.getuid?.() === 0) args.push('--no-sandbox')
// Headless Linux has no GPU: draw the map's WebGL in software. Real machines use their GPU.
if (process.platform === 'linux') args.push('--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader')

const app = await electron.launch({
  args,
  env: {
    ...process.env,
    CS_AI_PROVIDER: process.env.CS_AI_PROVIDER ?? 'mock',
    CS_SAVE_DIR: mkdtempSync(join(tmpdir(), 'cs-smoke-'))
  }
})

const problems = []
const expect = (ok, what) => ok || problems.push(what)
try {
  const page = await app.firstWindow()
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`))
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`))

  await page.waitForSelector('.nation', { timeout: 20_000 })
  await page.waitForTimeout(400)
  await shot(page, '01-masa.png')
  expect((await page.textContent('.calendar__turn')) === 'Tur 0', 'yeni oyun tur 0 ile başlamalı')

  // Talking is free.
  await page.fill('#order', 'Durum nedir?')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.chat--talk .chat__reply')
  expect((await page.textContent('.command__capital'))?.startsWith('3/3'), 'konuşmak sermaye harcamamalı')

  // A typed order becomes a decision; a card is the other way in.
  await page.fill('#order', 'Vergileri indir')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.pending__item')
  // Ready-made decisions live in a drawer over the map.
  await page.click('.btn--deck')
  const trade = page.locator('.card', { has: page.locator('.card__title', { hasText: 'Ticaret anlaşması' }) })
  await trade.locator('select').selectOption({ label: 'Yunanistan' })
  await trade.getByRole('button', { name: 'Karar ver' }).click()
  await page.waitForFunction(() => document.querySelectorAll('.pending__item').length === 2)
  await page.click('.deck__close')
  expect((await page.textContent('.command__capital'))?.startsWith('1/3'), 'iki karar iki sermaye harcamalı')
  await shot(page, '02-plan.png')

  await page.click('.btn--turn')
  await page.waitForSelector('.sheet')
  await page.waitForTimeout(300)
  await shot(page, '03-rapor.png')
  const report = (await page.textContent('.sheet')) ?? ''
  expect(report.includes('Vergi indirimi'), 'rapor barların nedenlerini göstermeli')
  await page.click('.sheet .btn--primary')
  expect((await page.textContent('.calendar__turn')) === 'Tur 1', 'tur ilerlemeli')
  await shot(page, '04-sonra.png')
} finally {
  await app.close()
}

if (problems.length) {
  console.error('Sorunlar:\n' + problems.join('\n'))
  process.exit(1)
}
console.log(`Smoke OK, ekran görüntüleri: ${outDir}/`)
