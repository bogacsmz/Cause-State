import { existsSync } from 'node:fs'
import { open, readFile, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { app, protocol } from 'electron'
import { PMTiles, type RangeResponse, type Source } from 'pmtiles'

// The map's files ship inside the game (resources/map, copied into the packaged app by
// electron-builder), and the renderer reads them only through this scheme:
//   cs-map://tiles/<world|physical|relief>/{z}/{x}/{y}   one tile, decompressed
//   cs-map://fonts/<font stack>/<range>.pbf              label glyphs
// Nothing else is served, and nothing leaves the machine.

export const MAP_SCHEME = 'cs-map'

const TILESETS = {
  world: { file: 'world.pmtiles', type: 'application/x-protobuf' },
  physical: { file: 'physical.pmtiles', type: 'application/x-protobuf' },
  relief: { file: 'relief.pmtiles', type: 'image/webp' }
} as const
type Tileset = keyof typeof TILESETS

const FONT_STACK = /^Noto Sans (Regular|Medium|Italic)$/
const FONT_RANGE = /^\d{1,5}-\d{1,5}$/
// A 1×1 transparent PNG: raster tiles that do not exist (open sea in the relief).
const TRANSPARENT_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

/** Must run before the app is ready. */
export function registerMapScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MAP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
  ])
}

/** resources/map in development, the app's own resources folder once packaged. */
export function mapDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'map') : join(app.getAppPath(), 'resources', 'map')
}

/** Reads byte ranges of a PMTiles file from disk. The file stays open for the session. */
class FileSource implements Source {
  private handle: Promise<FileHandle> | null = null
  constructor(private readonly path: string) {}

  getKey(): string {
    return this.path
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    this.handle ??= open(this.path, 'r')
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await (await this.handle).read(buffer, 0, length, offset)
    return { data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + bytesRead) }
  }
}

const cors = { 'Access-Control-Allow-Origin': '*' }

/** Serves the map files over cs-map://. Call once the app is ready. */
export function serveMap(dir: string = mapDir()): { ok: boolean; missing: string[] } {
  const missing = [...Object.values(TILESETS).map((t) => t.file), 'fonts'].filter((f) => !existsSync(join(dir, f)))
  if (missing.length > 0) console.error(`[harita] eksik dosya: ${missing.join(', ')} (${dir})`)
  const archives = new Map<Tileset, PMTiles>(
    (Object.keys(TILESETS) as Tileset[]).map((name) => [name, new PMTiles(new FileSource(join(dir, TILESETS[name].file)))])
  )

  protocol.handle(MAP_SCHEME, async (request) => {
    const url = new URL(request.url)
    const path = decodeURIComponent(url.pathname).split('/').filter(Boolean)
    try {
      if (url.host === 'tiles' && path.length === 4 && path[0]! in TILESETS) {
        const name = path[0] as Tileset
        const [z, x, y] = path.slice(1).map(Number) as [number, number, number]
        if (![z, x, y].every(Number.isInteger)) return new Response(null, { status: 400 })
        const tile = await archives.get(name)!.getZxy(z, x, y)
        if (tile) return new Response(new Uint8Array(tile.data), { headers: { 'Content-Type': TILESETS[name].type, ...cors } })
        // A missing vector tile is empty ground; a missing raster tile is transparent.
        return name === 'relief'
          ? new Response(TRANSPARENT_PNG, { headers: { 'Content-Type': 'image/png', ...cors } })
          : new Response(new Uint8Array(0), { headers: { 'Content-Type': TILESETS[name].type, ...cors } })
      }
      if (url.host === 'fonts' && path.length === 2 && FONT_STACK.test(path[0]!) && FONT_RANGE.test(path[1]!.replace(/\.pbf$/, ''))) {
        const file = join(dir, 'fonts', path[0]!, path[1]!)
        // Ranges the map's names never use are not shipped: an empty glyph set.
        const data = existsSync(file) ? await readFile(file) : Buffer.alloc(0)
        return new Response(data, { headers: { 'Content-Type': 'application/x-protobuf', ...cors } })
      }
    } catch (err) {
      console.error('[harita] okunamadı', request.url, err)
      return new Response(null, { status: 500, headers: cors })
    }
    return new Response(null, { status: 404, headers: cors })
  })
  return { ok: missing.length === 0, missing }
}
