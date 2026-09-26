// Copies the pinned label glyphs (Noto Sans, SIL OFL) into resources/map/fonts, so labels
// render offline. Only the Unicode ranges the map's names use (see map/sources.json).
//
//   npm run map:build     developer tool only
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { ASSETS, CACHE, ROOT, pinned, recordBuild, sources } from './lib.mjs'

const OUT = join(ASSETS, 'fonts')
rmSync(OUT, { recursive: true, force: true })
const files = []
for (const [path, sha256] of Object.entries(sources.fonts.files)) {
  const cached = await pinned(sources.fonts.base + path.split('/').map(encodeURIComponent).join('/'), join(CACHE, 'fonts', path), sha256)
  const out = join(OUT, path)
  mkdirSync(dirname(out), { recursive: true })
  copyFileSync(cached, out)
  files.push(relative(ROOT, out))
}
recordBuild('fonts', files, {
  source: 'Noto Sans glyphs (SIL Open Font License) from protomaps/basemaps-assets, map/sources.json',
  stacks: [...new Set(Object.keys(sources.fonts.files).map((p) => p.split('/')[0]))]
})
console.log(`${relative(ROOT, OUT)}: ${files.length} dosya`)
