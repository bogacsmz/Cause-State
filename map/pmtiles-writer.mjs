// A small PMTiles v3 writer for raster tilesets (tippecanoe only writes vector tiles).
// Spec: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
// One root directory (fine up to a few thousand tiles), gzip-compressed; identical tiles
// are stored once.
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { zxyToTileId } from 'pmtiles'

const TILE_TYPE = { mvt: 1, png: 2, jpeg: 3, webp: 4 }
const GZIP = 2
const NO_COMPRESSION = 1

function varint(out, value) {
  let v = value
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80)
    v = Math.floor(v / 0x80)
  }
  out.push(v)
}

function serializeDirectory(entries) {
  const out = []
  varint(out, entries.length)
  let lastId = 0
  for (const e of entries) {
    varint(out, e.tileId - lastId)
    lastId = e.tileId
  }
  for (const e of entries) varint(out, e.runLength)
  for (const e of entries) varint(out, e.length)
  entries.forEach((e, i) => {
    const prev = entries[i - 1]
    varint(out, i > 0 && e.offset === prev.offset + prev.length ? 0 : e.offset + 1)
  })
  return gzipSync(Buffer.from(out))
}

/**
 * @param tiles Array<{ z, x, y, data: Buffer }>
 * @param opts { type: 'webp' | 'png' | 'jpeg', minZoom, maxZoom, bounds: [w, s, e, n], center: [lon, lat, zoom], metadata }
 */
export function writePmtiles(tiles, opts) {
  const sorted = tiles.map((t) => ({ ...t, tileId: zxyToTileId(t.z, t.x, t.y) })).sort((a, b) => a.tileId - b.tileId)
  const contents = new Map()
  const chunks = []
  let dataLength = 0
  const entries = []
  for (const t of sorted) {
    const key = createHash('sha256').update(t.data).digest('hex')
    let stored = contents.get(key)
    if (!stored) {
      stored = { offset: dataLength, length: t.data.length }
      contents.set(key, stored)
      chunks.push(t.data)
      dataLength += t.data.length
    }
    entries.push({ tileId: t.tileId, offset: stored.offset, length: stored.length, runLength: 1 })
  }

  const root = serializeDirectory(entries)
  const metadata = gzipSync(Buffer.from(JSON.stringify(opts.metadata ?? {})))
  if (127 + root.length > 16384) throw new Error('kök dizin 16 KB sınırını aşıyor')

  const header = Buffer.alloc(127)
  header.write('PMTiles', 0, 'ascii')
  header.writeUInt8(3, 7)
  const rootOffset = 127
  const metadataOffset = rootOffset + root.length
  const dataOffset = metadataOffset + metadata.length
  const u64 = (pos, v) => header.writeBigUInt64LE(BigInt(v), pos)
  u64(8, rootOffset)
  u64(16, root.length)
  u64(24, metadataOffset)
  u64(32, metadata.length)
  u64(40, 0)
  u64(48, 0)
  u64(56, dataOffset)
  u64(64, dataLength)
  u64(72, entries.length)
  u64(80, entries.length)
  u64(88, contents.size)
  header.writeUInt8(0, 96) // not clustered: deduplicated tiles point back to earlier data
  header.writeUInt8(GZIP, 97)
  header.writeUInt8(NO_COMPRESSION, 98)
  header.writeUInt8(TILE_TYPE[opts.type], 99)
  header.writeUInt8(opts.minZoom, 100)
  header.writeUInt8(opts.maxZoom, 101)
  const e7 = (deg) => Math.round(deg * 1e7)
  const [w, s, e, n] = opts.bounds
  header.writeInt32LE(e7(w), 102)
  header.writeInt32LE(e7(s), 106)
  header.writeInt32LE(e7(e), 110)
  header.writeInt32LE(e7(n), 114)
  header.writeUInt8(opts.center[2], 118)
  header.writeInt32LE(e7(opts.center[0]), 119)
  header.writeInt32LE(e7(opts.center[1]), 123)

  return Buffer.concat([header, root, metadata, ...chunks])
}
