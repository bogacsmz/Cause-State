// Smoke test: launches the built app, sends an order, and saves screenshots.
// Run `npm run build` first. Uses the mock AI unless CS_AI_PROVIDER is set.
// Linux without a display: xvfb-run -a -s "-screen 0 1600x1000x24" npm run smoke
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

const outDir = process.env.SMOKE_OUT ?? 'test-results'
mkdirSync(outDir, { recursive: true })
const shot = (page, name) => page.screenshot({ path: join(outDir, name) })

const args = ['.']
// Chromium refuses to run as root without this; only relevant in CI containers.
if (process.platform === 'linux' && process.getuid?.() === 0) args.push('--no-sandbox')

const app = await electron.launch({
  args,
  env: { ...process.env, CS_AI_PROVIDER: process.env.CS_AI_PROVIDER ?? 'mock' }
})

const problems = []
try {
  const page = await app.firstWindow()
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`))

  await page.waitForSelector('.status--ok, .status--down', { timeout: 20_000 })
  await page.waitForTimeout(400)
  await shot(page, '01-acilis.png')

  const status = await page.textContent('.status__label')
  console.log(`AI durumu: ${status}`)

  await page.fill('#order', "Ankara'da acil kabine toplantısı yapılsın, ekonomi bakanı da hazır bulunsun.")
  await page.keyboard.press('Enter')
  await page.waitForSelector('.dispatch--done', { timeout: 120_000 })
  await shot(page, '02-cevap.png')

  const answer = (await page.textContent('.dispatch__body')) ?? ''
  console.log(`Cevap: ${answer.slice(0, 160)}…`)
  if (answer.trim().length === 0) problems.push('cevap boş')

  await page.fill('#order', 'Karadeniz filosunun hazırlık durumu nedir?')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.dispatch--streaming .caret', { timeout: 60_000 })
  await page.waitForTimeout(250)
  await shot(page, '03-akis.png')
  await page.waitForSelector('.dispatch--streaming', { state: 'detached', timeout: 120_000 })
} finally {
  await app.close()
}

if (problems.length) {
  console.error('Sorunlar:\n' + problems.join('\n'))
  process.exit(1)
}
console.log(`Smoke OK, ekran görüntüleri: ${outDir}/`)
