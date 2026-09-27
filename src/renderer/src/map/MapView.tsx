import 'maplibre-gl/dist/maplibre-gl.css'
import { Map as MapLibre, setWorkerUrl, type ExpressionSpecification, type PaddingOptions } from 'maplibre-gl'
// MapLibre's worker, bundled with its shared chunk into one file of the app.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useRef, useState } from 'react'
import type { MapView as GameMap } from '@shared/game/view'
import { MAP_COUNTRIES } from './colors'
import { PerfOverlay } from './PerfOverlay'
import { HATCH, MAP_LIMITS, mapStyle, playerExpressions } from './style'
import { applyStates, hatchImage, wantedStates } from './sync'

setWorkerUrl(workerUrl)

/** Tiles kept in memory per source; past this the oldest are dropped (no runaway memory). */
const TILE_CACHE = 160
/** Far out the map is a small picture of the world: render it at 1× to spare memory. */
const LOW_DETAIL_BELOW_ZOOM = 3
/** A map not loaded after this long is reported as broken (the files are local: it is fast). */
const LOAD_TIMEOUT_MS = 20_000
/** From this zoom a click picks a province rather than its country. */
const PROVINCE_CLICK_ZOOM = 5
/** Until the first GameView arrives. */
const DEFAULT_PLAYER = 'TUR'

const pixelRatioFor = (zoom: number): number => (zoom < LOW_DETAIL_BELOW_ZOOM ? 1 : Math.min(window.devicePixelRatio || 1, 2))

/** What the player clicked on the map. */
export interface MapSelection {
  kind: 'country' | 'province'
  id: string
  name: string
  /** The country it lies in on the map (the country itself for a country). */
  country: string
}

declare global {
  interface Window {
    /** The live map, for the end-to-end and performance scripts. */
    __csMap?: MapLibre
    /** Applies a MapView the way a new GameView does; returns how many features changed. */
    __csApplyMapView?: (game: GameMap) => number
  }
}

interface Props {
  /** The world as GameState has it; undefined until the game is loaded. */
  game: GameMap | undefined
  /** Room the HUD takes on each side: the camera keeps the player's country in the open middle. */
  padding: PaddingOptions
  selection: MapSelection | null
  onSelect: (selection: MapSelection | null) => void
}

/** Fitting a country never zooms in past this. */
const FIT_MAX_ZOOM = 5.6

function playerBounds(player: string): [number, number, number, number] | null {
  return MAP_COUNTRIES[player]?.bounds ?? null
}

function createMap(container: HTMLElement): MapLibre {
  return new MapLibre({
    container,
    style: mapStyle(DEFAULT_PLAYER),
    center: [35, 39],
    zoom: 4.5,
    minZoom: MAP_LIMITS.minZoom,
    maxZoom: MAP_LIMITS.maxZoom,
    maxPitch: 0,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    renderWorldCopies: false,
    maxTileCacheSize: TILE_CACHE,
    pixelRatio: pixelRatioFor(4),
    attributionControl: { compact: false }
  })
}

/** The world map: the full-window canvas the HUD floats on. Top-down only, no tilt or rotation. */
export function MapView({ game, padding, selection, onSelect }: Props): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<MapLibre | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const applied = useRef(new Map<string, string>())
  const player = useRef(DEFAULT_PLAYER)
  const selected = useRef<MapSelection | null>(null)
  const paddingRef = useRef(padding)
  paddingRef.current = padding
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

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
    // The stripes of occupied provinces are drawn here and handed over when a tile first asks.
    m.setMissingStyleImageResolver((id) => {
      if (id === HATCH && !m.hasImage(HATCH)) m.addImage(HATCH, hatchImage())
    })
    m.on('zoomend', () => {
      const want = pixelRatioFor(m.getZoom())
      if (want !== m.getPixelRatio()) m.setPixelRatio(want)
    })
    // A map that never finishes loading says so; a single failed tile or query only logs.
    let loaded = false
    const stalled = setTimeout(() => {
      if (!loaded) setFailed('harita dosyaları okunamadı.')
    }, LOAD_TIMEOUT_MS)
    m.on('error', (e) => console.warn('[harita]', e.error?.message ?? e.error))
    // A click picks the country; from zoom 5 on, where province names show, the province.
    // Only layers the style has are asked; the sea or empty ground picks nothing, quietly.
    m.on('click', (e) => {
      const layers = (m.getZoom() >= PROVINCE_CLICK_ZOOM ? ['province-fill', 'land'] : ['land']).filter((id) => m.getLayer(id))
      const hits = layers.length > 0 ? m.queryRenderedFeatures(e.point, { layers }) : []
      const province = hits.find((f) => f.layer.id === 'province-fill')
      const country = hits.find((f) => f.layer.id === 'land')
      const pick = province ?? country
      onSelectRef.current(
        pick
          ? {
              kind: province ? 'province' : 'country',
              id: String(province ? province.properties.pid : pick.properties.cid),
              name: String(pick.properties.name),
              country: String(pick.properties.cid)
            }
          : null
      )
    })
    // Layer events only query layers that exist.
    m.on('mouseenter', 'land', () => {
      m.getCanvas().style.cursor = 'pointer'
    })
    m.on('mouseleave', 'land', () => {
      m.getCanvas().style.cursor = ''
    })
    m.on('load', () => {
      loaded = true
      clearTimeout(stalled)
      // The camera fits the player's country into the open middle, once the panels' room is known.
      m.setPadding(paddingRef.current)
      const bounds = playerBounds(DEFAULT_PLAYER)
      if (bounds) m.fitBounds(bounds, { maxZoom: FIT_MAX_ZOOM, duration: 0 })
      setReady(true)
    })
    setMap(m)
    window.__csMap = m
    return () => {
      clearTimeout(stalled)
      m.remove()
      setMap(null)
      setReady(false)
      applied.current.clear()
      delete window.__csMap
      delete window.__csApplyMapView
    }
  }, [])

  // GameState → feature-state. Only what changed is touched; the tiles stay as they are.
  useEffect(() => {
    if (!map || !ready) return
    const apply = (g: GameMap): number => {
      if (g.player !== player.current) {
        player.current = g.player
        const p = playerExpressions(g.player)
        for (const id of ['player-glow', 'player-border']) map.setFilter(id, p.playerBorderFilter)
        map.setPaintProperty('province-lines', 'line-color', p.provinceLineColor as ExpressionSpecification)
        map.setPaintProperty('country-labels', 'text-color', p.countryLabelColor as ExpressionSpecification)
        const bounds = playerBounds(g.player)
        if (bounds) map.fitBounds(bounds, { maxZoom: FIT_MAX_ZOOM, duration: 0 })
      }
      return applyStates(map, wantedStates(g), applied.current)
    }
    window.__csApplyMapView = apply
    if (game) apply(game)
  }, [map, ready, game])

  // The clicked feature gets an outline.
  useEffect(() => {
    if (!map || !ready) return
    const layerOf = (s: MapSelection) => (s.kind === 'country' ? 'countries' : 'provinces')
    const prev = selected.current
    if (prev) map.setFeatureState({ source: 'world', sourceLayer: layerOf(prev), id: prev.id }, { selected: false })
    if (selection) map.setFeatureState({ source: 'world', sourceLayer: layerOf(selection), id: selection.id }, { selected: true })
    selected.current = selection
  }, [map, ready, selection])

  // Panels opening or folding move the open middle; the view follows it.
  useEffect(() => {
    map?.easeTo({ padding, duration: 300 })
  }, [map, padding])

  const home = (): void => {
    const bounds = playerBounds(player.current)
    if (map && bounds) map.fitBounds(bounds, { maxZoom: FIT_MAX_ZOOM, duration: 900 })
  }

  return (
    <div className="world" aria-label="Dünya haritası">
      <div ref={container} className="world__canvas" />
      {failed && <p className="world__error">Harita açılamadı: {failed}</p>}
      {map && !failed && (
        <button type="button" className="world__home" onClick={home}>
          Ülkeme dön
        </button>
      )}
      <PerfOverlay map={map} />
    </div>
  )
}
