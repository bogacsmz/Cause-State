import type { Map as MapLibre } from 'maplibre-gl'
import { useEffect, useState } from 'react'

interface Stats {
  fps: number
  worstMs: number
  zoom: number
  tiles: number
  cached: number
  heapMb: number | null
}

/**
 * F2 shows how the map runs on this machine: frames per second over the last second, the
 * longest frame, tiles held in memory and the JS heap. Off by default; costs nothing when off.
 */
export function PerfOverlay({ map }: { map: MapLibre | null }): React.JSX.Element | null {
  const [on, setOn] = useState(false)
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'F2') setOn((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!on || !map) return
    let frames: number[] = []
    let raf = 0
    const loop = (t: number): void => {
      frames.push(t)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    const timer = setInterval(() => {
      const now = performance.now()
      frames = frames.filter((t) => now - t < 1000)
      const gaps = frames.slice(1).map((t, i) => t - frames[i]!)
      // MapLibre internals (v6): tiles on screen and the capped cache of recent ones.
      const managers = Object.values((map as unknown as { style: { tileManagers: Record<string, TileManagerLike> } }).style.tileManagers)
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
      setStats({
        fps: frames.length,
        worstMs: gaps.length ? Math.max(...gaps) : 0,
        zoom: map.getZoom(),
        tiles: managers.reduce((n, m) => n + m._inViewTiles.getAllTiles().length, 0),
        cached: managers.reduce((n, m) => n + m._outOfViewCache.order.length, 0),
        heapMb: memory ? Math.round(memory.usedJSHeapSize / 1048576) : null
      })
    }, 500)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(timer)
    }
  }, [on, map])

  if (!on || !stats) return null
  return (
    <div className="perf" role="status">
      <strong>{stats.fps} FPS</strong> · en uzun kare {Math.round(stats.worstMs)} ms · zoom {stats.zoom.toFixed(1)} · karo {stats.tiles} ekranda, {stats.cached}{' '}
      önbellekte{stats.heapMb !== null && ` · JS ${stats.heapMb} MB`} <span className="perf__hint">F2 kapatır</span>
    </div>
  )
}

interface TileManagerLike {
  _inViewTiles: { getAllTiles(): unknown[] }
  _outOfViewCache: { order: unknown[] }
}
