// Builds the land-border graph from the map's own polygons: which provinces (admin-1) and
// which countries touch, and over how many kilometres. The groundwork for moving and
// occupying; no rules live here, only geometry.
//
//   npm run map:adjacency     (also part of npm run map:build; Node only, no tippecanoe)
//
// Two areas are neighbours when their outlines run within TOLERANCE of each other for at
// least MIN_SHARED_KM: a shared land border. A corner touch or a strait between two
// coasts does not count. Writes map/adjacency.json (git; the game imports it).
import { readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { CACHE, MAP, ROOT, pinned, recordBuild, sources } from './lib.mjs'

/** Degrees; about 330 m of latitude. */
const TOLERANCE = 0.003
const MIN_SHARED_KM = 1
/** Grid cell for the segment index, in degrees. */
const CELL = 0.05
const ISO_FIXES = { 'GR-A1': 'GR-I' }

const KM_PER_DEG = 111.32

async function load(key) {
  const { base, files } = sources.naturalEarth
  const { name, sha256 } = files[key]
  return JSON.parse(readFileSync(await pinned(base + name, join(CACHE, name), sha256), 'utf8')).features
}

/** Every ring of a (multi)polygon as a flat [x0, y0, x1, y1, …] array. */
function rings(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : []
  return polygons.flat().map((ring) => Float64Array.from(ring.flat()))
}

/** Squared distance, in degrees² at local scale, from (px, py) to segment (ax, ay)–(bx, by). */
function distanceSq(px, py, ax, ay, bx, by, kx) {
  const dx = (bx - ax) * kx
  const dy = by - ay
  const len = dx * dx + dy * dy
  let t = len === 0 ? 0 : (((px - ax) * kx) * dx + (py - ay) * dy) / len
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const ex = (ax - px) * kx + t * dx
  const ey = ay - py + t * dy
  return ex * ex + ey * ey
}

/**
 * Shared border length (km) between every pair of areas whose outlines run together.
 * @param areas Array<{ id, rings: Float64Array[] }>
 */
function sharedBorders(areas) {
  // Index every segment in a grid of CELL-sized cells.
  const cells = new Map()
  const key = (cx, cy) => cx * 100_000 + cy
  const segArea = []
  const segRing = []
  const segIndex = []
  areas.forEach((area, a) => {
    area.rings.forEach((ring, r) => {
      for (let i = 0; i + 3 < ring.length; i += 2) {
        const s = segArea.length
        segArea.push(a)
        segRing.push(ring)
        segIndex.push(i)
        const x0 = Math.floor((Math.min(ring[i], ring[i + 2]) - TOLERANCE) / CELL)
        const x1 = Math.floor((Math.max(ring[i], ring[i + 2]) + TOLERANCE) / CELL)
        const y0 = Math.floor((Math.min(ring[i + 1], ring[i + 3]) - TOLERANCE) / CELL)
        const y1 = Math.floor((Math.max(ring[i + 1], ring[i + 3]) + TOLERANCE) / CELL)
        for (let cx = x0; cx <= x1; cx++) {
          for (let cy = y0; cy <= y1; cy++) {
            const k = key(cx, cy)
            let list = cells.get(k)
            if (!list) cells.set(k, (list = []))
            list.push(s)
          }
        }
      }
      void r
    })
  })

  const tolSq = TOLERANCE * TOLERANCE
  const shared = new Map() // "a|b" → km, measured along a's outline
  areas.forEach((area, a) => {
    for (const ring of area.rings) {
      const n = ring.length / 2
      // For each vertex: the other areas whose outline passes within TOLERANCE.
      const near = new Array(n)
      for (let v = 0; v < n; v++) {
        const px = ring[2 * v]
        const py = ring[2 * v + 1]
        const kx = Math.cos((py * Math.PI) / 180)
        const list = cells.get(key(Math.floor(px / CELL), Math.floor(py / CELL)))
        let found = null
        if (list) {
          for (const s of list) {
            const b = segArea[s]
            if (b === a || found?.has(b)) continue
            const seg = segRing[s]
            const i = segIndex[s]
            if (distanceSq(px, py, seg[i], seg[i + 1], seg[i + 2], seg[i + 3], kx) <= tolSq) (found ??= new Set()).add(b)
          }
        }
        near[v] = found
      }
      // An edge whose two ends both run along area b counts towards the a–b border.
      for (let v = 0; v + 1 < n; v++) {
        const here = near[v]
        const next = near[v + 1]
        if (!here || !next) continue
        const x = ring[2 * v]
        const y = ring[2 * v + 1]
        const kx = Math.cos((y * Math.PI) / 180)
        const km = Math.hypot((ring[2 * v + 2] - x) * kx, ring[2 * v + 3] - y) * KM_PER_DEG
        for (const b of here) {
          if (!next.has(b)) continue
          const k = `${a}|${b}`
          shared.set(k, (shared.get(k) ?? 0) + km)
        }
      }
    }
  })

  // Symmetric graph: the longer of the two measurements, kept when long enough.
  const graph = Object.fromEntries(areas.map((area) => [area.id, {}]))
  for (const [k, km] of shared) {
    const [a, b] = k.split('|').map(Number)
    const both = Math.max(km, shared.get(`${b}|${a}`) ?? 0)
    if (both < MIN_SHARED_KM) continue
    graph[areas[a].id][areas[b].id] = Math.round(both)
    graph[areas[b].id][areas[a].id] = Math.round(both)
  }
  return graph
}

const sortObject = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)))

const started = Date.now()
const countries = (await load('countries')).map((f) => ({ id: f.properties.ADM0_A3, rings: rings(f.geometry) }))

// The same province ids as the tiles (map/build.mjs): ISO 3166-2 when unique, else NE's adm1_code.
const provinceFeatures = await load('provinces')
const iso = (p) => ISO_FIXES[p.iso_3166_2] ?? p.iso_3166_2
const isoCount = new Map()
for (const { properties: p } of provinceFeatures) isoCount.set(iso(p), (isoCount.get(iso(p)) ?? 0) + 1)
const usable = (code) => typeof code === 'string' && /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(code) && isoCount.get(code) === 1
const provinces = provinceFeatures.map((f) => ({ id: usable(iso(f.properties)) ? iso(f.properties) : f.properties.adm1_code, rings: rings(f.geometry) }))

const countryGraph = sharedBorders(countries)
const provinceGraph = sharedBorders(provinces)

// Two countries whose provinces touch are neighbours even where the country outlines keep
// apart (the UN buffer zone between the two parts of Cyprus): moving province by province
// must never cross a border the country graph does not know.
const countryOf = new Map(provinceFeatures.map((f, i) => [provinces[i].id, f.properties.adm0_a3]))
const viaProvinces = new Map()
for (const [a, neighbours] of Object.entries(provinceGraph)) {
  for (const [b, km] of Object.entries(neighbours)) {
    const ca = countryOf.get(a)
    const cb = countryOf.get(b)
    if (ca === cb || !countryGraph[ca] || !countryGraph[cb] || countryGraph[ca][cb]) continue
    viaProvinces.set(`${ca}|${cb}`, (viaProvinces.get(`${ca}|${cb}`) ?? 0) + km)
  }
}
for (const [pair, km] of viaProvinces) {
  const [ca, cb] = pair.split('|')
  countryGraph[ca][cb] = km
}

const out = {
  note: 'Land borders from Natural Earth 5.1.2 polygons (map/adjacency.mjs): neighbour id → shared border in km.',
  rule: { toleranceDeg: TOLERANCE, minSharedKm: MIN_SHARED_KM },
  countries: sortObject(Object.fromEntries(Object.entries(countryGraph).map(([id, n]) => [id, sortObject(n)]))),
  provinces: sortObject(Object.fromEntries(Object.entries(provinceGraph).map(([id, n]) => [id, sortObject(n)])))
}
const file = join(MAP, 'adjacency.json')
writeFileSync(file, JSON.stringify(out) + '\n')

const edges = (g) => Object.values(g).reduce((n, x) => n + Object.keys(x).length, 0) / 2
const isolated = (g) => Object.values(g).filter((x) => Object.keys(x).length === 0).length
const stats = {
  countries: { nodes: countries.length, borders: edges(countryGraph), withoutLandBorder: isolated(countryGraph) },
  provinces: { nodes: provinces.length, borders: edges(provinceGraph), withoutLandBorder: isolated(provinceGraph) },
  rule: out.rule
}
recordBuild('adjacency', [relative(ROOT, file)], stats)
console.log(JSON.stringify(stats))
console.log(`${relative(ROOT, file)} yazıldı, ${Math.round((Date.now() - started) / 1000)} sn`)
