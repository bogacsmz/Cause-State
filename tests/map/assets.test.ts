import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PMTiles } from 'pmtiles'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JS build script, no types
import { writePmtiles } from '../../map/pmtiles-writer.mjs'

// The game ships its map (resources/map): every file must be there, exactly as built.
const ROOT = join(__dirname, '../..')
const manifest = JSON.parse(readFileSync(join(ROOT, 'map/manifest.json'), 'utf8')) as {
  files: Record<string, { bytes: number; sha256: string }>
}

const memorySource = (data: Buffer) => ({
  getKey: () => 'bellek',
  getBytes: async (offset: number, length: number) => {
    const slice = data.subarray(offset, offset + length)
    return { data: slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) as ArrayBuffer }
  }
})

describe('shipped map files', () => {
  it('are all in the repository, byte for byte as the manifest says', () => {
    const files = Object.entries(manifest.files)
    expect(files.map(([f]) => f)).toEqual(expect.arrayContaining(['resources/map/world.pmtiles', 'resources/map/physical.pmtiles', 'resources/map/relief.pmtiles']))
    for (const [file, want] of files) {
      const path = join(ROOT, file)
      expect(existsSync(path), file).toBe(true)
      const data = readFileSync(path)
      expect({ file, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }).toEqual({ file, bytes: want.bytes, sha256: want.sha256 })
    }
  })

  it('stay small: under 30 MB in total', () => {
    const total = Object.values(manifest.files).reduce((n, f) => n + f.bytes, 0)
    expect(total).toBeLessThan(30 * 1024 * 1024)
  })

  it('open with the standard reader: Hatay is on the Turkish tile at zoom 6', async () => {
    const world = new PMTiles(memorySource(readFileSync(join(ROOT, 'resources/map/world.pmtiles'))))
    const header = await world.getHeader()
    expect([header.minZoom, header.maxZoom]).toEqual([0, 8])
    const tile = await world.getZxy(6, 38, 25)
    expect(tile?.data.byteLength).toBeGreaterThan(1000)
    expect(Buffer.from(tile!.data).includes(Buffer.from('TR-31'))).toBe(true)
  })
})

describe('raster PMTiles writer', () => {
  it('writes tiles the standard reader reads back, storing identical tiles once', async () => {
    const a = Buffer.from('karo-a')
    const b = Buffer.from('karo-b')
    const file = writePmtiles(
      [
        { z: 0, x: 0, y: 0, data: a },
        { z: 1, x: 1, y: 0, data: b },
        { z: 1, x: 0, y: 1, data: a }
      ],
      { type: 'webp', minZoom: 0, maxZoom: 1, bounds: [-180, -85, 180, 85], center: [0, 0, 0] }
    )
    const reader = new PMTiles(memorySource(file))
    const header = await reader.getHeader()
    expect([header.numAddressedTiles, header.numTileContents, header.tileType]).toEqual([3, 2, 4])
    expect(Buffer.from((await reader.getZxy(1, 1, 0))!.data).toString()).toBe('karo-b')
    expect(Buffer.from((await reader.getZxy(1, 0, 1))!.data).toString()).toBe('karo-a')
    expect(await reader.getZxy(1, 1, 1)).toBeUndefined()
  })
})
