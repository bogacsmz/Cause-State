// Map step 4 proof: the land-border graph (map/adjacency.json), with sample questions and
// the neighbours drawn on the map (outlined through feature-state; nothing in the app changes).
//   npm run build && xvfb-run -a -s "-screen 0 1600x1000x24" npm run kanit:harita-komsu
// Writes test-results/harita-komsu/: screenshots and rapor.md.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

const outDir = join('test-results', 'harita-komsu')
mkdirSync(outDir, { recursive: true })
const graph = JSON.parse(readFileSync('map/adjacency.json', 'utf8'))
const places = JSON.parse(readFileSync('map/places.json', 'utf8'))
const manifest = JSON.parse(readFileSync('map/manifest.json', 'utf8'))
const provName = (id) => places.provinces[id]?.[1] ?? id
const countryName = (id) => places.countries[id] ?? id

const lines = []
const say = (s) => {
  console.log(s)
  lines.push(s)
}

say('# Harita adım 4: komşuluk grafiği\n')
const { countries, provinces, rule } = manifest.adjacency
say(`Kural: sınırlar ${Math.round(rule.toleranceDeg * 111_000)} m içinde en az ${rule.minSharedKm} km birlikte gidiyorsa komşu (köşe teması ve boğaz sayılmaz).`)
say(`- İller: ${provinces.nodes} il, ${provinces.borders} kara sınırı, ${provinces.withoutLandBorder} ilin kara komşusu yok (adalar)`)
say(`- Ülkeler: ${countries.nodes} ülke, ${countries.borders} kara sınırı, ${countries.withoutLandBorder} ülkenin kara komşusu yok`)

say('\n## Örnek sorgular\n')
const ask = (q, a) => say(`- ${q} → **${a}**`)
const provPair = (a, b) => ask(`${provName(a)} ↔ ${provName(b)} komşu mu?`, graph.provinces[a]?.[b] ? `evet, ~${graph.provinces[a][b]} km` : 'hayır')
const countryPair = (a, b) => ask(`${countryName(a)} ↔ ${countryName(b)} sınır komşusu mu?`, graph.countries[a]?.[b] ? `evet, ~${graph.countries[a][b]} km` : 'hayır')
provPair('TR-31', 'SY-HL')
provPair('TR-31', 'SY-ID')
provPair('TR-31', 'SY-LA')
provPair('TR-31', 'TR-06')
provPair('TR-34', 'TR-41')
provPair('TR-34', 'TR-16')
countryPair('TUR', 'SYR')
countryPair('TUR', 'GRC')
countryPair('TUR', 'IRN')
countryPair('TUR', 'CYP')
countryPair('TUR', 'RUS')
const list = (ids, name) => ids.map((id) => `${name(id)} (${id})`).join(', ')
say(`- Hatay'ın komşuları: ${list(Object.keys(graph.provinces['TR-31']), provName)}`)
say(`- Türkiye'nin komşuları: ${list(Object.keys(graph.countries.TUR), countryName)}`)

const args = ['.']
if (process.platform === 'linux' && process.getuid?.() === 0) args.push('--no-sandbox')
const app = await electron.launch({
  args,
  env: { ...process.env, CS_AI_PROVIDER: 'mock', CS_SAVE_DIR: mkdtempSync(join(tmpdir(), 'cs-komsu-')), ...(process.platform === 'linux' ? { CS_SOFTWARE_GL: '1' } : {}) }
})
try {
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForSelector('.nation', { timeout: 30_000 })
  await page.waitForFunction(() => window.__csMap?.loaded() && window.__csMap.areTilesLoaded(), null, { timeout: 60_000 })
  const idle = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const m = window.__csMap
          if (m.loaded() && m.areTilesLoaded() && !m.isMoving()) setTimeout(resolve, 400)
          else m.once('idle', () => setTimeout(resolve, 400))
        })
    )

  // Hatay and its neighbours: Hatay outlined, its neighbours tinted and outlined.
  const hatay = Object.keys(graph.provinces['TR-31'])
  await page.evaluate(
    ({ neighbours }) => {
      const m = window.__csMap
      m.jumpTo({ center: [36.9, 36.6], zoom: 6.6 })
      const f = (id) => ({ source: 'world', sourceLayer: 'provinces', id })
      m.setFeatureState(f('TR-31'), { selected: true, fill: '#d9b15c' })
      for (const id of neighbours) m.setFeatureState(f(id), { selected: true, fill: 'rgba(240, 236, 226, 0.45)' })
    },
    { neighbours: hatay }
  )
  await idle()
  await page.screenshot({ path: join(outDir, '01-hatay-komsulari.png') })

  // Türkiye's neighbouring countries outlined.
  await page.evaluate(
    ({ neighbours, provinces }) => {
      const m = window.__csMap
      for (const id of provinces) m.setFeatureState({ source: 'world', sourceLayer: 'provinces', id }, { selected: false, fill: null })
      m.jumpTo({ center: [38, 38.5], zoom: 4.2 })
      for (const id of neighbours) m.setFeatureState({ source: 'world', sourceLayer: 'countries', id }, { selected: true })
    },
    { neighbours: Object.keys(graph.countries.TUR), provinces: ['TR-31', ...hatay] }
  )
  await idle()
  await page.screenshot({ path: join(outDir, '02-turkiye-komsu-ulkeler.png') })
  say(`\nSayfa hataları: ${errors.length === 0 ? 'yok' : errors.join(' | ')}`)
} finally {
  await app.close()
}
writeFileSync(join(outDir, 'rapor.md'), lines.join('\n') + '\n')
console.log(`\nEkran görüntüleri ve rapor: ${outDir}/`)
