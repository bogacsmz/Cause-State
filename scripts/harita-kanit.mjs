// Map proof: opens the built app, visits the zoom levels, measures frames while panning and
// zooming, and watches memory over many flights around the world.
//   npm run build && xvfb-run -a -s "-screen 0 1600x1000x24" npm run kanit:harita [-- dpr=2]
// Writes test-results/harita/: a screenshot per zoom level, rapor.md and rapor.json.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

const opts = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')))
const dpr = Number(opts.dpr ?? 1)
const outDir = opts.out ?? join('test-results', 'harita')
mkdirSync(outDir, { recursive: true })

const args = ['.']
if (process.platform === 'linux' && process.getuid?.() === 0) args.push('--no-sandbox')
if (dpr !== 1) args.push(`--force-device-scale-factor=${dpr}`)
const app = await electron.launch({
  args,
  env: {
    ...process.env,
    CS_AI_PROVIDER: 'mock',
    CS_SAVE_DIR: mkdtempSync(join(tmpdir(), 'cs-harita-')),
    // Headless Linux has no GPU; a real machine draws with its own.
    ...(process.platform === 'linux' ? { CS_SOFTWARE_GL: '1' } : {})
  }
})

const report = { dpr, views: [], motion: [], memory: [] }
const lines = []
const say = (s) => {
  console.log(s)
  lines.push(s)
}

/** Memory of every process of the app, in MB (resident set). */
const memory = async () => {
  const metrics = await app.evaluate(({ app }) => app.getAppMetrics())
  const byType = {}
  for (const m of metrics) byType[m.type] = (byType[m.type] ?? 0) + m.memory.workingSetSize / 1024
  const total = Object.values(byType).reduce((a, b) => a + b, 0)
  return { totalMb: Math.round(total), byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, Math.round(v)])) }
}

try {
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForSelector('.nation', { timeout: 20_000 })
  await page.waitForFunction(() => window.__csMap?.loaded() && window.__csMap.areTilesLoaded(), null, { timeout: 60_000 })

  const gl = await page.evaluate(() => {
    const c = document.createElement('canvas').getContext('webgl2')
    const info = c?.getExtension('WEBGL_debug_renderer_info')
    return info ? c.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'bilinmiyor'
  })
  report.gl = gl
  say(`# Harita kanıtı\n\nÇizim: ${gl} · piksel oranı ${dpr} · pencere 1440×900`)

  const idle = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const m = window.__csMap
          if (m.loaded() && m.areTilesLoaded() && !m.isMoving()) setTimeout(resolve, 300)
          else m.once('idle', () => setTimeout(resolve, 300))
        })
    )

  // ── 1. Zoom levels ────────────────────────────────────────────────────────
  say('\n## Zoom kademeleri (ekrandaki çizili öğe sayısı)\n')
  say('| Görünüm | zoom | ülke adı | başkent | diğer şehir | il sınırı | il adı | piksel oranı |')
  say('|---|---|---|---|---|---|---|---|')
  const views = [
    ['01-dunya', 'Dünya', [18, 28], 1.6],
    ['02-baskentler', 'Avrupa ve Orta Doğu', [32, 42], 3.1],
    ['03-iller', 'Türkiye (açılış)', [35.2, 39.1], 4.6],
    ['04-daha-cok-sehir', 'Doğu Akdeniz', [36.4, 37.2], 6.5],
    ['05-kucuk-sehirler', 'Marmara', [29.2, 40.8], 8.4]
  ]
  for (const [file, label, center, zoom] of views) {
    await page.evaluate(({ center, zoom }) => window.__csMap.jumpTo({ center, zoom }), { center, zoom })
    await idle()
    const counts = await page.evaluate(() => {
      const m = window.__csMap
      const seen = {}
      for (const f of m.queryRenderedFeatures()) {
        const key = f.layer.id === 'city-labels' ? (f.properties.cap === 2 ? 'capital' : 'city') : f.layer.id
        seen[key] ??= new Set()
        seen[key].add(f.id ?? JSON.stringify(f.properties))
      }
      return { ...Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, v.size])), pixelRatio: m.getPixelRatio() }
    })
    await page.screenshot({ path: join(outDir, `${file}.png`) })
    report.views.push({ file, label, zoom, counts })
    const n = (k) => counts[k] ?? 0
    say(`| ${label} | ${zoom} | ${n('country-labels')} | ${n('capital')} | ${n('city')} | ${n('province-lines')} | ${n('province-labels')} | ${counts.pixelRatio} |`)
  }

  // ── 2. Frames while moving ────────────────────────────────────────────────
  say('\n## Hareket (kare ölçümü)\n')
  say('| Hareket | süre | ort. FPS | kare süresi p95 | en uzun kare |')
  say('|---|---|---|---|---|')
  const motions = [
    ['Dünyadan Türkiye’ye uçuş', 'flyTo', { center: [35.2, 39.1], zoom: 5.2, duration: 3000 }, { center: [0, 20], zoom: 1.5 }],
    ['Kaydırma (20 adım)', 'pan', { steps: 20, dx: 180 }, { center: [20, 40], zoom: 5 }],
    ['Yakınlaştırma 3 → 8', 'easeTo', { zoom: 8, duration: 2500 }, { center: [35.2, 39.1], zoom: 3 }],
    ['Uzaklaştırma 8 → 2', 'easeTo', { zoom: 2, duration: 2500 }, { center: [35.2, 39.1], zoom: 8 }]
  ]
  for (const [label, kind, params, start] of motions) {
    await page.evaluate((s) => window.__csMap.jumpTo(s), start)
    await idle()
    const r = await page.evaluate(
      ({ kind, params }) =>
        new Promise((resolve) => {
          const m = window.__csMap
          const times = []
          let running = true
          const tick = (t) => {
            times.push(t)
            if (running) requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
          const done = () => {
            running = false
            const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b)
            const ms = times.at(-1) - times[0]
            resolve({ ms, frames: gaps.length, fps: (gaps.length / ms) * 1000, p95: gaps[Math.floor(gaps.length * 0.95)], worst: gaps.at(-1) })
          }
          if (kind === 'pan') {
            let i = 0
            const step = () => {
              if (i++ >= params.steps) return done()
              m.panBy([params.dx * (i % 2 ? 1 : -0.6), 40], { duration: 160 })
              m.once('moveend', step)
            }
            step()
          } else {
            m.once('moveend', done)
            m[kind](params)
          }
        }),
      { kind, params }
    )
    report.motion.push({ label, ...r })
    say(`| ${label} | ${(r.ms / 1000).toFixed(1)} sn | ${r.fps.toFixed(0)} | ${r.p95.toFixed(0)} ms | ${r.worst.toFixed(0)} ms |`)
  }
  // The same flight over an empty map (sea colour only): the machine's own drawing floor.
  const layers = await page.evaluate(() => window.__csMap.getStyle().layers.map((l) => l.id).filter((id) => id !== 'sea'))
  await page.evaluate((ids) => ids.forEach((id) => window.__csMap.setLayoutProperty(id, 'visibility', 'none')), layers)
  await page.evaluate(() => window.__csMap.jumpTo({ center: [0, 20], zoom: 1.5 }))
  await idle()
  const floor = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const m = window.__csMap
        const times = []
        let running = true
        const tick = (t) => {
          times.push(t)
          if (running) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
        m.once('moveend', () => {
          running = false
          resolve((times.length - 1) / ((times.at(-1) - times[0]) / 1000))
        })
        m.flyTo({ center: [35.2, 39.1], zoom: 5.2, duration: 3000 })
      })
  )
  await page.evaluate((ids) => ids.forEach((id) => window.__csMap.setLayoutProperty(id, 'visibility', 'visible')), layers)
  report.emptyMapFps = floor
  say(`| Aynı uçuş, boş harita (sadece deniz rengi) | 3.0 sn | ${floor.toFixed(0)} | | |`)

  // ── 3. Memory over many flights ──────────────────────────────────────────
  say('\n## Bellek: dünyanın her yerine 60 uçuş\n')
  say('| Uçuş | toplam bellek | GPU süreci | sayfa (Tab) | JS yığını |')
  say('|---|---|---|---|---|')
  const sample = async (label) => {
    const mem = await memory()
    const heap = await page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576))
    report.memory.push({ label, ...mem, heapMb: heap })
    say(`| ${label} | ${mem.totalMb} MB | ${mem.byType.GPU ?? 0} MB | ${mem.byType.Tab ?? 0} MB | ${heap} MB |`)
  }
  await sample('başta')
  // A fixed pseudo-random tour, so runs are comparable.
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  for (let i = 1; i <= 60; i++) {
    const center = [-170 + rand() * 340, -55 + rand() * 125]
    const zoom = 2 + rand() * 7
    await page.evaluate((v) => window.__csMap.jumpTo(v), { center, zoom })
    await idle()
    if (i % 20 === 0) await sample(`${i}. uçuş`)
  }
  // MapLibre internals (v6): tiles on screen plus the capped cache of recently seen ones.
  const tiles = await page.evaluate(() =>
    Object.fromEntries(
      Object.entries(window.__csMap.style.tileManagers).map(([id, t]) => [id, { ekranda: t._inViewTiles.getAllTiles().length, onbellek: t._outOfViewCache.order.length }])
    )
  )
  report.tilesInMemory = tiles
  say(`\nBellekteki karolar, kaynak başına (önbellek üst sınırı 160): ${Object.entries(tiles).map(([id, t]) => `${id} ${t.ekranda} ekranda + ${t.onbellek} önbellekte`).join(' · ')}`)

  report.errors = errors
  say(`\nSayfa hataları: ${errors.length === 0 ? 'yok' : errors.slice(0, 5).join(' | ')}`)
} finally {
  await app.close()
}

writeFileSync(join(outDir, 'rapor.md'), lines.join('\n') + '\n')
writeFileSync(join(outDir, 'rapor.json'), JSON.stringify(report, null, 2))
console.log(`\nEkran görüntüleri ve rapor: ${outDir}/`)
