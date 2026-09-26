// Shared by the map build scripts: where things live, pinned downloads, the manifest.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MAP = dirname(fileURLToPath(import.meta.url))
export const ROOT = join(MAP, '..')
/** Downloads (git-ignored). */
export const CACHE = join(MAP, '.cache')
/** Intermediate files (git-ignored). */
export const WORK = join(MAP, '.work')
/** What the game ships and reads: committed to git, copied into the packaged app. */
export const ASSETS = join(ROOT, 'resources', 'map')

export const sources = JSON.parse(readFileSync(join(MAP, 'sources.json'), 'utf8'))

export const sha256 = (data) => createHash('sha256').update(data).digest('hex')

/** Downloads `url` into the cache once, and refuses a file whose sha256 is not the pinned one. */
export async function pinned(url, file, want) {
  if (!existsSync(file)) {
    console.log(`indiriliyor: ${url}`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  }
  const got = sha256(readFileSync(file))
  if (got !== want) throw new Error(`${file}: sha256 tutmuyor (${got}); dosyayı silip tekrar dene`)
  return file
}

export function run(cmd, args, what = cmd) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf8', maxBuffer: 1 << 26 })
  if (r.error) throw new Error(`${what} çalışmadı (${r.error.message}).`)
  if (r.status !== 0) throw new Error(`${what} hata verdi:\n${r.stderr.slice(-2000)}`)
  return r.stderr
}

const MANIFEST = join(MAP, 'manifest.json')

/** Records one build's output: its files (path relative to the repo, size, sha256) and details. */
export function recordBuild(section, files, details) {
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { files: {} }
  manifest.files ??= {}
  for (const key of Object.keys(manifest.files)) if (manifest.files[key].section === section) delete manifest.files[key]
  for (const file of files) {
    const data = readFileSync(join(ROOT, file))
    manifest.files[file] = { section, bytes: data.length, sha256: sha256(data) }
  }
  manifest.files = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => (a < b ? -1 : 1)))
  manifest[section] = details
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
}

export const mb = (bytes) => Math.round((bytes / 1048576) * 100) / 100
