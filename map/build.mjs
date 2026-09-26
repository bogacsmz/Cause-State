// Builds the vector map from Natural Earth, into two files the game ships:
// - resources/map/world.pmtiles: countries, provinces (admin-1, never districts), cities and
//   their names, zoom 0–8 (the map overzooms past 8);
// - resources/map/physical.pmtiles: sea depth, lakes, rivers, sea names, zoom 0–6, simpler.
// Also writes map/places.json, the ids the game can use.
//
//   npm run map:build     developer tool only: needs tippecanoe ≥ 2.17 (brew/apt install tippecanoe)
//
// The game never runs this: the built file is committed and shipped inside the app.
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join, relative } from 'node:path'
import polylabel from 'polylabel'
import { ASSETS, CACHE, MAP, ROOT, WORK, mb, pinned, recordBuild, run, sources } from './lib.mjs'

const MAX_ZOOM = 8
const PHYSICAL_MAX_ZOOM = 6

/**
 * Level of detail. A feature is absent from every tile below its min zoom, so the far-out
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
  ],
  /** Sea depth shading fades out as the map zooms in; tiles past this zoom leave it out. */
  depthMaxZoom: 5,
  /** Natural Earth scalerank limits: the big lakes (Van, Tuz) and the main rivers (Kızılırmak, Sakarya, Aras). */
  lakeMaxScalerank: 7,
  riverMaxScalerank: 8
}

const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(0, Math.floor(z)))
const cityMinZoom = (scalerank, capital) =>
  capital ? LOD.capitals : (LOD.cityByScalerank.find(([max]) => scalerank <= max)?.[1] ?? MAX_ZOOM)
// Natural Earth's label and feature zooms are one step finer than a 512 px vector map.
const neZoom = (z) => clampZoom((z ?? MAX_ZOOM + 1) - 1)

/** Natural Earth codes that differ from current ISO 3166-2 (NE keeps Attica's pre-2010 code). */
const ISO_FIXES = { 'GR-A1': 'GR-I' }

const point = ([lon, lat]) => ({ type: 'Point', coordinates: [Number(lon.toFixed(5)), Number(lat.toFixed(5))] })
// The min zoom travels as the `minz` attribute and is enforced by a tippecanoe zoom filter
// (see zoomFilter): per-feature `tippecanoe.minzoom` loses features in tippecanoe 2.49.
const feature = (fid, minz, properties, geometry) => ({
  type: 'Feature',
  properties: { ...(fid ? { fid } : {}), ...properties, ...(minz > 0 ? { minz } : {}) },
  geometry
})

/** A point well inside a (multi)polygon, for its label. */
function labelPoint(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  const area = (ring) => Math.abs(ring.reduce((s, [x1, y1], i) => { const [x2, y2] = ring[(i + 1) % ring.length]; return s + x1 * y2 - x2 * y1 }, 0))
  const largest = polygons.reduce((a, b) => (area(b[0]) > area(a[0]) ? b : a))
  return polylabel(largest, 0.05)
}

async function loadSources() {
  const { base, files } = sources.naturalEarth
  const out = {}
  for (const [key, { name, sha256 }] of Object.entries(files)) {
    out[key] = JSON.parse(readFileSync(await pinned(base + name, join(CACHE, name), sha256), 'utf8')).features
  }
  return out
}

/** Keys the game uses: country = Natural Earth ADM0_A3, province = ISO 3166-2 (e.g. TR-31), else NE's adm1_code. */
function transform(src) {
  const layers = {
    depth: [],
    countries: [],
    lakes: [],
    rivers: [],
    provinces: [],
    country_labels: [],
    province_labels: [],
    sea_labels: [],
    cities: []
  }

  for (const [key, d] of [['shelf', 200], ['deep', 2000], ['abyss', 4000]]) {
    for (const { geometry } of src[key]) layers.depth.push(feature(null, 0, { d }, geometry))
  }

  for (const { properties: p, geometry } of src.countries) {
    const cid = p.ADM0_A3
    const name = p.NAME_TR || p.NAME
    layers.countries.push(feature(p.NE_ID, 0, { cid, name, mc: p.MAPCOLOR9 }, geometry))
    layers.country_labels.push(feature(p.NE_ID, neZoom(p.MIN_LABEL), { cid, name, lr: p.LABELRANK }, point([p.LABEL_X, p.LABEL_Y])))
  }

  const iso = (p) => ISO_FIXES[p.iso_3166_2] ?? p.iso_3166_2
  const isoCount = new Map()
  for (const { properties: p } of src.provinces) isoCount.set(iso(p), (isoCount.get(iso(p)) ?? 0) + 1)
  const usableIso = (code) => typeof code === 'string' && /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(code) && isoCount.get(code) === 1
  const seen = new Set()
  for (const { properties: p, geometry } of src.provinces) {
    const pid = usableIso(iso(p)) ? iso(p) : p.adm1_code
    if (seen.has(pid)) throw new Error(`il kimliği tekrar ediyor: ${pid}`)
    seen.add(pid)
    const props = { pid, cid: p.adm0_a3, name: p.name_tr || p.name }
    layers.provinces.push(feature(p.ne_id, LOD.provinces, props, geometry))
    layers.province_labels.push(feature(p.ne_id, LOD.provinceLabels, { ...props, lr: p.labelrank }, point([p.longitude, p.latitude])))
  }

  for (const { properties: p } of src.cities) {
    const cap = p.FEATURECLA === 'Admin-0 capital' ? 2 : /Admin-1 (region )?capital/.test(p.FEATURECLA) ? 1 : 0
    layers.cities.push(
      feature(p.NE_ID, cityMinZoom(p.SCALERANK, cap === 2), { name: p.NAME_TR || p.NAME, cid: p.ADM0_A3, sr: p.SCALERANK, cap }, point([p.LONGITUDE, p.LATITUDE]))
    )
  }

  for (const { properties: p, geometry } of src.lakes) {
    if (p.scalerank <= LOD.lakeMaxScalerank) layers.lakes.push(feature(p.ne_id, Math.min(PHYSICAL_MAX_ZOOM, neZoom(p.min_zoom)), {}, geometry))
  }
  for (const { properties: p, geometry } of src.rivers) {
    if (geometry && p.scalerank <= LOD.riverMaxScalerank) {
      layers.rivers.push(feature(null, Math.min(PHYSICAL_MAX_ZOOM, neZoom(p.min_zoom)), { sr: p.scalerank }, geometry))
    }
  }
  for (const { properties: p, geometry } of src.seas) {
    if (!geometry || !p.name) continue
    const minz = Math.min(PHYSICAL_MAX_ZOOM, neZoom(p.min_label))
    layers.sea_labels.push(feature(p.ne_id, minz, { name: p.name_tr || p.name, sr: p.scalerank }, point(labelPoint(geometry))))
  }
  return layers
}

/** Keeps each feature only from its `minz` on (one clause per distinct min zoom), and depth only to its max zoom. */
function zoomFilter(layers) {
  const filter = {}
  for (const [name, features] of Object.entries(layers)) {
    const zooms = [...new Set(features.map((f) => f.properties.minz ?? 0))].filter((z) => z > 0).sort((a, b) => a - b)
    if (zooms.length > 0) filter[name] = ['any', ['!has', 'minz'], ...zooms.map((z) => ['all', ['==', 'minz', z], ['>=', '$zoom', z]])]
  }
  filter.depth = ['<=', '$zoom', LOD.depthMaxZoom]
  return filter
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

const PHYSICAL = ['depth', 'lakes', 'rivers', 'sea_labels']

/** One tileset: its layers → MBTiles (for the statistics) → PMTiles. */
function tileset(name, layers, maxZoom, extra) {
  const work = join(WORK, name)
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  for (const [layer, features] of Object.entries(layers)) {
    writeFileSync(join(work, `${layer}.ndjson`), features.map((f) => JSON.stringify(f)).join('\n') + '\n')
  }
  const mbtiles = join(work, `${name}.mbtiles`)
  run('tippecanoe', [
    '-o', mbtiles, '--force', '--quiet',
    '-Z0', `-z${maxZoom}`,
    '-n', `Cause & State ${name}`,
    '-A', '<a href="https://www.naturalearthdata.com/">Natural Earth</a>',
    '--use-attribute-for-id=fid',
    // Neighbouring polygons simplify along the same line: no gaps or slivers between provinces.
    '--detect-shared-borders',
    // Points are thinned by min zoom (LOD above), never dropped at random.
    '-r1',
    '-j', JSON.stringify(zoomFilter(layers)),
    ...extra,
    ...Object.keys(layers).flatMap((layer) => ['-L', `${layer}:${join(work, `${layer}.ndjson`)}`])
  ])
  const out = join(ASSETS, `${name}.pmtiles`)
  rmSync(out, { force: true })
  run('tile-join', ['-o', out, '--force', '--quiet', mbtiles])
  return { file: relative(ROOT, out), tiles: tileStats(mbtiles) }
}

const started = Date.now()
const tippecanoe = run('tippecanoe', ['--version'], 'tippecanoe (brew/apt install tippecanoe)').trim()
const all = transform(await loadSources())
const pick = (keep) => Object.fromEntries(Object.entries(all).filter(([name]) => keep(name)))
mkdirSync(ASSETS, { recursive: true })
const world = tileset('world', pick((name) => !PHYSICAL.includes(name)), MAX_ZOOM, [])
// Physical detail matters less: simpler shapes, and the map overzooms it past z6.
const physical = tileset('physical', pick((name) => PHYSICAL.includes(name)), PHYSICAL_MAX_ZOOM, ['--simplification=4'])

recordBuild('vector', [world.file, physical.file], {
  source: 'Natural Earth 5.1.2 (public domain), map/sources.json',
  builtWith: tippecanoe,
  zoom: { world: MAX_ZOOM, physical: PHYSICAL_MAX_ZOOM, overzoom: true },
  lod: LOD,
  features: Object.fromEntries(Object.entries(all).map(([name, f]) => [name, f.length])),
  tiles: { world: world.tiles, physical: physical.tiles }
})

// The ids the game can use, small enough for git: country → name, province → [country, name].
const sorted = (entries) => Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : 1)))
const places = {
  countries: sorted(all.countries.map((f) => [f.properties.cid, f.properties.name])),
  provinces: sorted(all.provinces.map((f) => [f.properties.pid, [f.properties.cid, f.properties.name]]))
}
writeFileSync(join(MAP, 'places.json'), JSON.stringify(places) + '\n')

for (const { file, tiles } of [world, physical]) {
  console.log(`${file}: ${mb(statSync(join(ROOT, file)).size)} MB, ${tiles.reduce((n, t) => n + t.tiles, 0)} karo`)
}
console.log(`${Math.round((Date.now() - started) / 1000)} sn`)
