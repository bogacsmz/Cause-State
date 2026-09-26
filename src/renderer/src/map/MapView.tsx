import 'maplibre-gl/dist/maplibre-gl.css'
import { Map as MapLibre, setWorkerUrl, type PaddingOptions } from 'maplibre-gl'
// MapLibre's worker, bundled with its shared chunk into one file of the app.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useRef, useState } from 'react'
import { PerfOverlay } from './PerfOverlay'
import { HOME_VIEW, MAP_LIMITS, mapStyle } from './style'

setWorkerUrl(workerUrl)

/** Tiles kept in memory per source; past this the oldest are dropped (no runaway memory). */
const TILE_CACHE = 160
/** Far out the map is a small picture of the world: render it at 1× to spare memory. */
const LOW_DETAIL_BELOW_ZOOM = 3

const pixelRatioFor = (zoom: number): number => (zoom < LOW_DETAIL_BELOW_ZOOM ? 1 : Math.min(window.devicePixelRatio || 1, 2))

declare global {
  interface Window {
    /** The live map, for the end-to-end and performance scripts. */
    __csMap?: MapLibre
  }
}

interface Props {
  /** Room the HUD takes on each side: the camera centres in the open middle. */
  padding: PaddingOptions
}

function createMap(container: HTMLElement): MapLibre {
  return new MapLibre({
    container,
    style: mapStyle(),
    center: HOME_VIEW.center,
    zoom: HOME_VIEW.zoom,
    minZoom: MAP_LIMITS.minZoom,
    maxZoom: MAP_LIMITS.maxZoom,
    maxPitch: 0,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    renderWorldCopies: false,
    maxTileCacheSize: TILE_CACHE,
    pixelRatio: pixelRatioFor(HOME_VIEW.zoom),
    attributionControl: { compact: false }
  })
}

/** The world map: the full-window canvas the HUD floats on. Top-down only, no tilt or rotation. */
export function MapView({ padding }: Props): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibre | null>(null)
  const [live, setLive] = useState<MapLibre | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    if (!container.current) return
    let m: MapLibre
    try {
      m = createMap(container.current)
    } catch (err) {
      // No WebGL2 (an old or blocklisted GPU): the game still runs, only without the map.
      console.error('[harita]', err)
      const text = err instanceof Error ? err.message : String(err)
      setFailed(/webgl/i.test(text) ? 'bu bilgisayarın ekran kartı haritayı çizemiyor (WebGL2 yok). Oyun haritasız sürüyor.' : text)
      return
    }
    m.keyboard.disableRotation()
    m.touchZoomRotate.disableRotation()
    m.on('zoomend', () => {
      const want = pixelRatioFor(m.getZoom())
      if (want !== m.getPixelRatio()) m.setPixelRatio(want)
    })
    m.on('error', (e) => {
      console.error('[harita]', e.error)
      if (!m.isStyleLoaded()) setFailed(e.error?.message ?? 'bilinmeyen hata')
    })
    map.current = m
    setLive(m)
    window.__csMap = m
    return () => {
      m.remove()
      map.current = null
      setLive(null)
      delete window.__csMap
    }
  }, [])

  useEffect(() => {
    map.current?.setPadding(padding)
  }, [padding])

  return (
    <div className="world" aria-label="Dünya haritası">
      <div ref={container} className="world__canvas" />
      {failed && <p className="world__error">Harita açılamadı: {failed}</p>}
      <PerfOverlay map={live} />
    </div>
  )
}
