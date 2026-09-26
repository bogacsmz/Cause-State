// Builds the relief layer: Natural Earth's 1:50m shaded relief (public domain) → a light
// shadow overlay → resources/map/relief.pmtiles (512 px WebP tiles, zoom 0–4; the map
// overzooms past 4). Flat land and the sea are fully transparent, so the overlay only
// darkens slopes in shadow; the land and sea colours stay the map's own. Shadows alone
// (black with alpha) compress about four times better than shadows plus highlights.
//
//   npm run map:build     developer tool only (sharp and geotiff are dev dependencies)
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fromFile } from 'geotiff'
import { PMTiles } from 'pmtiles'
import sharp from 'sharp'
import { ASSETS, CACHE, ROOT, WORK, mb, pinned, recordBuild, run, sources } from './lib.mjs'
import { writePmtiles } from './pmtiles-writer.mjs'

const OUT = join(ASSETS, 'relief.pmtiles')
const TILE = 512
const MAX_ZOOM = 4
/** The source's value for flat ground and open sea; a few steps either side count as flat. */
const FLAT = 206
const DEAD_ZONE = 5
const QUALITY = 50
const ALPHA_QUALITY = 30

// 1. The pinned source, unzipped.
const zip = await pinned(sources.relief.url, join(CACHE, sources.relief.name), sources.relief.sha256)
const work = join(WORK, 'relief')
mkdirSync(work, { recursive: true })
run('unzip', ['-o', '-q', zip, 'SR_50M.tif', '-d', work], 'unzip')
const image = await (await fromFile(join(work, 'SR_50M.tif'))).getImage()
const [raster] = await image.readRasters()
const base = { width: image.getWidth(), height: image.getHeight(), data: raster }
if (base.width !== 10800 || base.height !== 5400) throw new Error(`beklenmeyen raster boyutu ${base.width}x${base.height}`)

// 2. Halved copies for the far-out zooms, so small tiles average the relief instead of aliasing it.
const halve = (src) => {
  const width = Math.floor(src.width / 2)
  const height = Math.floor(src.height / 2)
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = 2 * y * src.width + 2 * x
      data[y * width + x] = (src.data[i] + src.data[i + 1] + src.data[i + src.width] + src.data[i + src.width + 1] + 2) >> 2
    }
  }
  return { width, height, data }
}
const levels = [base]
while (levels.at(-1).width / 2 >= TILE) levels.push(halve(levels.at(-1)))

// 3. Web Mercator tiles, sampled bilinearly from the equirectangular source.
function renderTile(z, tx, ty) {
  const world = TILE * 2 ** z
  const src = levels.findLast((l) => l.width >= world) ?? base
  const perDegree = src.width / 360
  const rgba = Buffer.alloc(TILE * TILE * 4)
  let visible = false
  for (let py = 0; py < TILE; py++) {
    const my = (ty * TILE + py + 0.5) / world
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI
    const sy = Math.min(src.height - 1.001, Math.max(0, (90 - lat) * perDegree - 0.5))
    const y0 = Math.floor(sy)
    const fy = sy - y0
    for (let px = 0; px < TILE; px++) {
      const lon = ((tx * TILE + px + 0.5) / world) * 360 - 180
      const sx = Math.min(src.width - 1.001, Math.max(0, (lon + 180) * perDegree - 0.5))
      const x0 = Math.floor(sx)
      const fx = sx - x0
      const i = y0 * src.width + x0
      const d = src.data
      const v = (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + src.width] * (1 - fx) + d[i + src.width + 1] * fx) * fy
      const o = (py * TILE + px) * 4
      if (v < FLAT - DEAD_ZONE) rgba[o + 3] = Math.min(255, Math.round(((FLAT - DEAD_ZONE - v) / FLAT) * 255 * 1.4))
      if (rgba[o + 3] > 0) visible = true
    }
  }
  return { rgba, visible }
}

const started = Date.now()
const tiles = []
for (let z = 0; z <= MAX_ZOOM; z++) {
  for (let x = 0; x < 2 ** z; x++) {
    for (let y = 0; y < 2 ** z; y++) {
      const { rgba, visible } = renderTile(z, x, y)
      // Empty ocean tiles are left out; the map simply draws nothing there.
      if (!visible) continue
      const data = await sharp(rgba, { raw: { width: TILE, height: TILE, channels: 4 } })
        .webp({ quality: QUALITY, alphaQuality: ALPHA_QUALITY, effort: 6 })
        .toBuffer()
      tiles.push({ z, x, y, data })
    }
  }
}

writeFileSync(
  OUT,
  writePmtiles(tiles, {
    type: 'webp',
    minZoom: 0,
    maxZoom: MAX_ZOOM,
    bounds: [-180, -85.051129, 180, 85.051129],
    center: [35, 39, 3],
    metadata: { name: 'Cause & State relief', attribution: 'Natural Earth', tileSize: TILE }
  })
)

// 4. Read it back with the standard reader, as the game will.
const reader = new PMTiles({
  getKey: () => OUT,
  getBytes: async (offset, length) => {
    const buf = readFileSync(OUT).subarray(offset, offset + length)
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }
  }
})
const header = await reader.getHeader()
const probe = await reader.getZxy(4, 9, 6)
if (!probe || probe.data.byteLength === 0) throw new Error('okuma testi: Türkiye karosu (4/9/6) yok')

const file = relative(ROOT, OUT)
const byZoom = Array.from({ length: MAX_ZOOM + 1 }, (_, z) => {
  const zt = tiles.filter((t) => t.z === z)
  return { z, tiles: zt.length, kb: Math.round(zt.reduce((n, t) => n + t.data.length, 0) / 1024) }
})
recordBuild('relief', [file], {
  source: 'Natural Earth SR_50M shaded relief (public domain), map/sources.json',
  tileSize: TILE,
  format: 'webp',
  zoom: { min: 0, max: MAX_ZOOM, overzoom: true },
  flatValue: FLAT,
  deadZone: DEAD_ZONE,
  tiles: byZoom,
  readBack: { tileType: header.tileType, addressed: header.numAddressedTiles, contents: header.numTileContents }
})
console.log(`${file}: ${mb(statSync(OUT).size)} MB, ${tiles.length} karo, ${Math.round((Date.now() - started) / 1000)} sn`)
