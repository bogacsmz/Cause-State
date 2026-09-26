// Builds the world map tiles: Natural Earth countries, provinces (admin-1, never districts)
// and cities → one PMTiles file, zoom 0–8 (the map overzooms past 8). Also writes the
// small files that go to git: manifest.json (size, checksum, LOD) and places.json (ids).
//
//   npm run map:build          needs tippecanoe ≥ 2.17 on PATH (apt/brew install tippecanoe)
//
// Sources are pinned (map/sources.json) and checked by sha256. The output is too big for
// git: it goes to map/dist/ (ignored), and its size and checksum go to map/manifest.json.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAP = dirname(fileURLToPath(import.meta.url))
const CACHE = join(MAP, '.cache')
const DIST = join(MAP, 'dist')
const WORK = join(DIST, 'work')
const OUT = join(DIST, 'world.pmtiles')
const MAX_ZOOM = 8

/**
 * Level of detail. Tiles below a feature's min zoom do not carry it at all, so the far-out
 * views stay light: country names only at z0–2, capitals from z3, provinces and big cities
 * from z4, then smaller cities zoom by zoom (Natural Earth's scalerank: 0 = biggest).
 */
export const LOD = {
  provinces: 4,
  provinceLabels: 5,
  capitals: 3,
  cityByScalerank: [
    [2, 4],
    [4, 5],
    [6, 6],
    [7, 7],
    [10, 8]
  ]
}

const cityMinZoom = (scalerank, capital) =>
  capital ? LOD.capitals : (LOD.cityByScalerank.find(([max]) => scalerank <= max)?.[1] ?? MAX_ZOOM)

// Natural Earth's label zooms are one step finer than a 512 px vector map.
const countryLabelMinZoom = (minLabel) => Math.min(MAX_ZOOM, Math.max(0, Math.floor(minLabel) - 1))

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

async function fetchSources() {
  const sources = JSON.parse(readFileSync(join(MAP, 'sources.json'), 'utf8'))
  mkdirSync(CACHE, { recursive: true })
  const files = {}
  for (const [key, { name, sha256: want }] of Object.entries(sources.files)) {
    const file = join(CACHE, name)
    if (!existsSync(file)) {
      console.log(`indiriliyor: ${name}`)
      const res = await fetch(sources.base + name)
      if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
      writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    }
    const got = sha256(file)
    if (got !== want) throw new Error(`${name}: sha256 tutmuyor (${got}); dosyayı silip tekrar dene`)
    files[key] = JSON.parse(readFileSync(file, 'utf8')).features
  }
  return files
}

const point = (lon, lat) => ({ type: 'Point', coordinates: [Number(lon.toFixed(5)), Number(lat.toFixed(5))] })
// The min zoom travels as the `minz` attribute and is enforced by a tippecanoe zoom filter
// (see zoomFilter): per-feature `tippecanoe.minzoom` loses features in tippecanoe 2.49.
const feature = (fid, minz, properties, geometry) => ({ type: 'Feature', properties: { fid, ...properties, ...(minz > 0 ? { minz } : {}) }, geometry })

/** Natural Earth codes that differ from current ISO 3166-2 (NE keeps Attica's pre-2010 code). */
const ISO_FIXES = { 'GR-A1': 'GR-I' }

/** Keys the game uses: country = Natural Earth ADM0_A3, province = ISO 3166-2 (e.g. TR-31), else NE's adm1_code. */
function transform({ countries, provinces, cities }) {
  const layers = { countries: [], country_labels: [], provinces: [], province_labels: [], cities: [] }

  for (const { properties: p, geometry } of countries) {
    const cid = p.ADM0_A3
    const name = p.NAME_TR || p.NAME
    layers.countries.push(feature(p.NE_ID, 0, { cid, name, mc: p.MAPCOLOR9 }, geometry))
    layers.country_labels.push(feature(p.NE_ID, countryLabelMinZoom(p.MIN_LABEL), { cid, name, lr: p.LABELRANK }, point(p.LABEL_X, p.LABEL_Y)))
  }

  const iso = (p) => ISO_FIXES[p.iso_3166_2] ?? p.iso_3166_2
  const isoCount = new Map()
  for (const { properties: p } of provinces) isoCount.set(iso(p), (isoCount.get(iso(p)) ?? 0) + 1)
  const usableIso = (iso) => typeof iso === 'string' && /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(iso) && isoCount.get(iso) === 1
  const seen = new Set()
  for (const { properties: p, geometry } of provinces) {
    const pid = usableIso(iso(p)) ? iso(p) : p.adm1_code
    if (seen.has(pid)) throw new Error(`il kimliği tekrar ediyor: ${pid}`)
    seen.add(pid)
    const props = { pid, cid: p.adm0_a3, name: p.name_tr || p.name }
    layers.provinces.push(feature(p.ne_id, LOD.provinces, props, geometry))
    layers.province_labels.push(feature(p.ne_id, LOD.provinceLabels, { ...props, lr: p.labelrank }, point(p.longitude, p.latitude)))
  }

  for (const { properties: p } of cities) {
    const cap = p.FEATURECLA === 'Admin-0 capital' ? 2 : /Admin-1 (region )?capital/.test(p.FEATURECLA) ? 1 : 0
    layers.cities.push(
      feature(p.NE_ID, cityMinZoom(p.SCALERANK, cap === 2), { name: p.NAME_TR || p.NAME, cid: p.ADM0_A3, sr: p.SCALERANK, cap }, point(p.LONGITUDE, p.LATITUDE))
    )
  }
  return layers
}

/** Keeps each feature only from its `minz` on: one clause per distinct min zoom in the layer. */
function zoomFilter(layers) {
  const filter = {}
  for (const [name, features] of Object.entries(layers)) {
    const zooms = [...new Set(features.map((f) => f.properties.minz ?? 0))].filter((z) => z > 0).sort((a, b) => a - b)
    if (zooms.length === 0) continue
    filter[name] = ['any', ['!has', 'minz'], ...zooms.map((z) => ['all', ['==', 'minz', z], ['>=', '$zoom', z]])]
  }
  return filter
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf8' })
  if (r.error) throw new Error(`${cmd} çalışmadı (${r.error.message}). tippecanoe kurulu mu?`)
  if (r.status !== 0) throw new Error(`${cmd} hata verdi:\n${r.stderr.slice(-2000)}`)
  return r.stderr
}

/** Tile count and sizes per zoom, read from the MBTiles intermediate. */
function tileStats(mbtiles) {
  const db = new DatabaseSync(mbtiles, { readOnly: true })
  const rows = db
    .prepare('SELECT zoom_level AS z, COUNT(*) AS tiles, SUM(LENGTH(tile_data)) AS bytes, MAX(LENGTH(tile_data)) AS maxBytes FROM tiles GROUP BY zoom_level ORDER BY zoom_level')
    .all()
  db.close()
  return rows.map((r) => ({ z: r.z, tiles: r.tiles, kb: Math.round(r.bytes / 1024), maxTileKb: Math.round((r.maxBytes / 1024) * 10) / 10 }))
}

const started = Date.now()
const layers = transform(await fetchSources())
rmSync(WORK, { recursive: true, force: true })
mkdirSync(WORK, { recursive: true })
for (const [name, features] of Object.entries(layers)) {
  writeFileSync(join(WORK, `${name}.ndjson`), features.map((f) => JSON.stringify(f)).join('\n') + '\n')
}

const mbtiles = join(WORK, 'world.mbtiles')
const tippecanoeVersion = run('tippecanoe', ['--version']).trim()
run('tippecanoe', [
  '-o', mbtiles, '--force', '--quiet',
  '-Z0', `-z${MAX_ZOOM}`,
  '-n', 'Cause & State world',
  '-A', '<a href="https://www.naturalearthdata.com/">Natural Earth</a>',
  '--use-attribute-for-id=fid',
  // Neighbouring polygons simplify along the same line: no gaps or slivers between provinces.
  '--detect-shared-borders',
  // Points are thinned by min zoom (LOD above), never dropped at random.
  '-r1',
  '-j', JSON.stringify(zoomFilter(layers)),
  ...Object.keys(layers).flatMap((name) => ['-L', `${name}:${join(WORK, `${name}.ndjson`)}`])
])
const stats = tileStats(mbtiles)
rmSync(OUT, { force: true })
run('tile-join', ['-o', OUT, '--force', '--quiet', mbtiles])

const bytes = statSync(OUT).size
const manifest = {
  file: relative(join(MAP, '..'), OUT),
  bytes,
  mb: Math.round((bytes / 1024 / 1024) * 100) / 100,
  sha256: sha256(OUT),
  builtWith: tippecanoeVersion,
  source: 'Natural Earth 5.1.2 (public domain), map/sources.json',
  zoom: { min: 0, max: MAX_ZOOM, overzoom: true },
  lod: LOD,
  features: Object.fromEntries(Object.entries(layers).map(([name, f]) => [name, f.length])),
  tiles: stats
}
writeFileSync(join(MAP, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

// The ids the game can use, small enough for git: country → name, province → [country, name].
const sorted = (entries) => Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : 1)))
const places = {
  countries: sorted(layers.countries.map((f) => [f.properties.cid, f.properties.name])),
  provinces: sorted(layers.provinces.map((f) => [f.properties.pid, [f.properties.cid, f.properties.name]]))
}
writeFileSync(join(MAP, 'places.json'), JSON.stringify(places) + '\n')
console.log(`${manifest.file}: ${manifest.mb} MB, ${stats.reduce((n, s) => n + s.tiles, 0)} karo, ${Math.round((Date.now() - started) / 1000)} sn`)
console.log(`sha256 ${manifest.sha256}`)
