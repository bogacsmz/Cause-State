// Renders build/icon.png (1024×1024) from the SVG below with headless Chromium.
// Only needed when the icon design changes: node scripts/make-icon.mjs
// Set CHROMIUM_PATH if Playwright's own browser isn't installed.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const font = readFileSync(
  resolve('node_modules/@fontsource-variable/newsreader/files/newsreader-latin-wght-italic.woff2')
).toString('base64')

// macOS icon grid: 824px rounded square centred on a 1024px canvas.
const html = `<!doctype html><html><head><style>
@font-face { font-family: 'Newsreader'; font-style: italic; font-weight: 200 800;
  src: url(data:font/woff2;base64,${font}) format('woff2'); }
html, body { margin: 0; background: transparent; }
</style></head><body>
<svg id="icon" width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#16202a"/><stop offset="1" stop-color="#0a0e12"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="42%" r="55%">
      <stop offset="0" stop-color="#c9a55c" stop-opacity="0.18"/><stop offset="1" stop-color="#c9a55c" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="card"><rect x="100" y="100" width="824" height="824" rx="186"/></clipPath>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#bg)"/>
  <g clip-path="url(#card)" fill="none" stroke="#243140" stroke-width="3">
    <ellipse cx="512" cy="512" rx="330" ry="162"/>
    <ellipse cx="512" cy="512" rx="220" ry="162"/>
    <ellipse cx="512" cy="512" rx="110" ry="162"/>
    <line x1="182" y1="512" x2="842" y2="512"/>
  </g>
  <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#glow)"/>
  <text x="512" y="648" text-anchor="middle" font-family="Newsreader" font-style="italic" font-weight="420"
        font-size="470" fill="#d4b06a">&amp;</text>
  <rect x="101.5" y="101.5" width="821" height="821" rx="184.5" fill="none" stroke="#2d3945" stroke-width="3"/>
</svg></body></html>`

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } })
await page.setContent(html)
await page.evaluate(() => document.fonts.ready)
await page.locator('#icon').screenshot({ path: 'build/icon.png', omitBackground: true })
await browser.close()
console.log('build/icon.png yazıldı')
