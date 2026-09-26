// Checks every shipped map file against map/manifest.json (size and sha256) and prints the
// PMTiles headers. Needs nothing but Node: run it on a fresh clone or after a rebuild.
//   npm run map:verify
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(ROOT, 'map/manifest.json'), 'utf8'))

// PMTiles v3 header: 127 bytes, little-endian (github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md).
function header(data) {
  const h = data.subarray(0, 127)
  if (h.toString('ascii', 0, 7) !== 'PMTiles' || h[7] !== 3) return 'PMTiles v3 değil'
  const e7 = (o) => h.readInt32LE(o) / 1e7
  return {
    tiles: Number(h.readBigUInt64LE(72)),
    type: ['?', 'mvt', 'png', 'jpeg', 'webp', 'avif'][h[99]],
    zoom: `${h[100]}–${h[101]}`,
    bounds: [e7(102), e7(106), e7(110), e7(114)]
  }
}

let bad = 0
let total = 0
for (const [file, want] of Object.entries(manifest.files)) {
  const path = join(ROOT, file)
  if (!existsSync(path)) {
    console.log(`YOK     ${file}`)
    bad++
    continue
  }
  const data = readFileSync(path)
  total += data.length
  const ok = data.length === want.bytes && createHash('sha256').update(data).digest('hex') === want.sha256
  if (!ok) bad++
  const info = file.endsWith('.pmtiles') ? ` ${JSON.stringify(header(data))}` : ''
  if (!ok || info) console.log(`${ok ? 'AYNI ' : 'FARKLI'}  ${file} ${(data.length / 1048576).toFixed(2)} MB${info}`)
}
const fonts = Object.keys(manifest.files).filter((f) => f.includes('/fonts/')).length
console.log(`${Object.keys(manifest.files).length} dosya (${fonts} font), toplam ${(total / 1048576).toFixed(2)} MB`)
console.log(bad === 0 ? 'Hepsi manifest ile AYNI: boyut ve sha256 tutuyor.' : `${bad} dosya eksik ya da farklı.`)
process.exit(bad === 0 ? 0 : 1)
