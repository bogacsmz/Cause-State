// Map step 3 proof: the political map, GameState → feature-state recolouring without any
// tile loads, the info panel on click, and panels that leave the map room.
//   npm run build && xvfb-run -a -s "-screen 0 1600x1000x24" npm run kanit:harita-renk
// Writes test-results/harita-renk/: screenshots and rapor.md.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

const outDir = join('test-results', 'harita-renk')
mkdirSync(outDir, { recursive: true })
const args = ['.']
if (process.platform === 'linux' && process.getuid?.() === 0) args.push('--no-sandbox')
const app = await electron.launch({
  args,
  env: {
    ...process.env,
    CS_AI_PROVIDER: 'mock',
    CS_TEST_HOOKS: '1',
    CS_SAVE_DIR: mkdtempSync(join(tmpdir(), 'cs-renk-')),
    ...(process.platform === 'linux' ? { CS_SOFTWARE_GL: '1' } : {})
  }
})

const lines = []
const say = (s) => {
  console.log(s)
  lines.push(s)
}

try {
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  const tileRequests = []
  page.on('request', (r) => r.url().startsWith('cs-map://tiles/') && tileRequests.push(r.url()))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForSelector('.nation', { timeout: 30_000 })
  await page.waitForFunction(() => window.__csMap?.loaded() && window.__csMap.areTilesLoaded(), null, { timeout: 60_000 })
  const idle = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const m = window.__csMap
          if (m.loaded() && m.areTilesLoaded() && !m.isMoving()) setTimeout(resolve, 300)
          else m.once('idle', () => setTimeout(resolve, 300))
        })
    )
  const shot = (name) => page.screenshot({ path: join(outDir, `${name}.png`) })
  const clickAt = async (lngLat) => {
    // Close the panel of the last click first, so it never sits over the next spot.
    if (await page.$('.map-info')) await page.click('.map-info__close')
    const p = await page.evaluate((ll) => window.__csMap.project(ll), lngLat)
    await page.mouse.click(p.x, p.y)
    await page.waitForSelector('.map-info')
    await page.waitForTimeout(900)
    return (await page.textContent('.map-info')).replace(/\s+/g, ' ').trim()
  }
  /** Is the player's whole country inside the part of the window no panel covers? */
  const playerInOpenArea = () =>
    page.evaluate(() => {
      const m = window.__csMap
      const pad = m.getPadding()
      const canvas = m.getCanvas().getBoundingClientRect()
      const b = [26.07, 35.82, 44.81, 42.1]
      const sw = m.project([b[0], b[1]])
      const ne = m.project([b[2], b[3]])
      const open = { left: pad.left, right: canvas.width - pad.right, top: pad.top, bottom: canvas.height - pad.bottom }
      return { inside: sw.x >= open.left - 2 && ne.x <= open.right + 2 && ne.y >= open.top - 2 && sw.y <= open.bottom + 2, openWidth: Math.round(open.right - open.left) }
    })

  say('# Harita adım 3: politik harita, GameState → renk, tıklama\n')

  // ── 1. Political map, Türkiye first ──────────────────────────────────────
  await idle()
  await shot('01-acilis')
  const home = await playerInOpenArea()
  const tur = await page.evaluate(() => window.__csMap.getFeatureState({ source: 'world', sourceLayer: 'countries', id: 'TUR' }))
  say(`Açılış: Türkiye'nin feature-state'i ${JSON.stringify(tur)}; ülkenin tamamı panellerin kapatmadığı alanda: ${home.inside ? 'evet' : 'HAYIR'} (açık alan ${home.openWidth} px)`)

  await page.evaluate(() => window.__csMap.jumpTo({ center: [28, 35], zoom: 2.2 }))
  await idle()
  await shot('02-dunya')
  const colours = await page.evaluate(() => {
    const seen = new Map()
    for (const f of window.__csMap.queryRenderedFeatures({ layers: ['land'] })) seen.set(f.properties.cid, f.properties.mc)
    return { countries: seen.size, slots: new Set(seen.values()).size }
  })
  say(`Dünya görünümü: ekranda ${colours.countries} ülke, ${colours.slots} ayrı renk (komşular aynı rengi almaz)`)

  // ── 2. Clicks: the info panel reads GameState ────────────────────────────
  say('\n## Tıklama → bilgi paneli\n')
  await page.evaluate(() => window.__csMap.jumpTo({ center: [35.5, 38.5], zoom: 4.6 }))
  await idle()
  const clicks = [
    ['Türkiye (oyuncu)', [33, 39.2], '03-tik-turkiye'],
    ['Suriye (oyunda)', [38.8, 35.3], '04-tik-suriye'],
    ['Bulgaristan (oyun dışı)', [25.3, 42.7], null]
  ]
  for (const [label, at, file] of clicks) {
    const text = await clickAt(at)
    if (file) await shot(file)
    say(`- ${label}: "${text.slice(0, 190)}"`)
  }

  // ── 3. GameState changes hands → the map recolours, no tile loads ────────
  say('\n## Kodda il sahibi değişiyor → harita\n')
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.__csMap.jumpTo({ center: [36.9, 36.9], zoom: 6.4 }))
  await idle()
  const hatayBefore = await clickAt([36.25, 36.35])
  say(`Önce, Hatay'a tıklama: "${hatayBefore}"`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  await shot('05-once')

  const tilesBefore = tileRequests.length
  // In the main process: Hatay goes to Syria, Gaziantep is held by Syria but still Turkish.
  await app.evaluate(async () => {
    await globalThis.__csDebug.setProvince('TR-31', 'SYR', 'SYR')
    await globalThis.__csDebug.setProvince('TR-27', 'TUR', 'SYR')
  })
  const took = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const m = window.__csMap
        const t0 = performance.now()
        window.__csRefresh().then(() => {
          m.triggerRepaint()
          m.once('render', () => resolve(Math.round(performance.now() - t0)))
        })
      })
  )
  await page.waitForTimeout(600)
  const tilesAfter = tileRequests.length
  const states = await page.evaluate(() =>
    Object.fromEntries(['TR-31', 'TR-27', 'TR-06'].map((id) => [id, window.__csMap.getFeatureState({ source: 'world', sourceLayer: 'provinces', id })]))
  )
  await shot('06-sonra')
  say(`Oyun durumu değişti (Hatay → Suriye; Gaziantep Suriye'nin elinde, sahibi Türkiye).`)
  say(`- Durumdan ekrana: ${took} ms (IPC ile yeni görünüm + feature-state + ilk kare)`)
  say(`- Bu sırada inen karo: ${tilesAfter - tilesBefore}`)
  say(`- feature-state: ${JSON.stringify(states)}`)
  say(`- Hatay'a tıklama: "${await clickAt([36.25, 36.35])}"`)
  await shot('07-hatay-sonra')
  say(`- Gaziantep'e tıklama: "${await clickAt([37.35, 37.05])}"`)
  await shot('08-gaziantep-isgal')
  await page.keyboard.press('Escape')

  // ── 4. Panels leave the map room ─────────────────────────────────────────
  say('\n## Paneller\n')
  await app.evaluate(async () => {
    await globalThis.__csDebug.setProvince('TR-31', 'TUR', 'TUR')
    await globalThis.__csDebug.setProvince('TR-27', 'TUR', 'TUR')
  })
  await page.evaluate(() => window.__csRefresh())
  await page.click('.world__home')
  await page.waitForTimeout(1200)
  await idle()
  const open = await playerInOpenArea()
  await page.click('.fold--left')
  await page.click('.fold--right')
  await page.waitForTimeout(600)
  await idle()
  const folded = await playerInOpenArea()
  await shot('09-paneller-katli')
  say(`Paneller açık: Türkiye açık alanda ${open.inside ? 'evet' : 'HAYIR'}, açık alan ${open.openWidth} px`)
  say(`Paneller katlı: Türkiye açık alanda ${folded.inside ? 'evet' : 'HAYIR'}, açık alan ${folded.openWidth} px`)
  await page.click('.hud-tab--left')
  await page.click('.hud-tab--right')

  say(`\nSayfa hataları: ${errors.length === 0 ? 'yok' : errors.slice(0, 5).join(' | ')}`)
} finally {
  await app.close()
}
writeFileSync(join(outDir, 'rapor.md'), lines.join('\n') + '\n')
console.log(`\nEkran görüntüleri ve rapor: ${outDir}/`)
