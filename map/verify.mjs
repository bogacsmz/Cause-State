// Checks map/dist/world.pmtiles against map/manifest.json (size and sha256) and prints its
// PMTiles header. Use it after building, or after downloading a released copy.
//   npm run map:verify
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(ROOT, 'map/manifest.json'), 'utf8'))
const file = join(ROOT, manifest.file)
if (!existsSync(file)) {
  console.error(`${manifest.file} yok. Üretmek için: npm run map:build`)
  process.exit(1)
}
const data = readFileSync(file)
const sha = createHash('sha256').update(data).digest('hex')

// PMTiles v3 header: 127 bytes, little-endian (github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md).
const h = data.subarray(0, 127)
if (h.toString('ascii', 0, 7) !== 'PMTiles' || h[7] !== 3) throw new Error('PMTiles v3 değil')
const u64 = (o) => Number(h.readBigUInt64LE(o))
const header = {
  addressedTiles: u64(72),
  tileEntries: u64(80),
  tileContents: u64(88),
  tileType: ['?', 'mvt', 'png', 'jpeg', 'webp', 'avif'][h[99]],
  tileCompression: ['?', 'none', 'gzip', 'brotli', 'zstd'][h[98]],
  zoom: `${h[100]}–${h[101]}`,
  bounds: [h.readInt32LE(102), h.readInt32LE(106), h.readInt32LE(110), h.readInt32LE(114)].map((v) => v / 1e7)
}
const ok = data.length === manifest.bytes && sha === manifest.sha256
console.log(JSON.stringify({ file: manifest.file, mb: Math.round((data.length / 1048576) * 100) / 100, sha256: sha, ...header }, null, 2))
console.log(ok ? 'Manifest ile AYNI: boyut ve sha256 tutuyor.' : 'Manifest ile FARKLI: dosya bozuk ya da başka bir sürüm.')
process.exit(ok ? 0 : 1)
