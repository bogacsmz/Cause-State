import { useMemo } from 'react'
import { EXTENT, meridian, outline, parallel } from '../lib/equal-earth'

const TROPIC = 23.44

// Placeholder world frame: a real Equal Earth graticule. The playable map replaces it in phase 1.
export function MapStage(): React.JSX.Element {
  const paths = useMemo(
    () => ({
      outline: outline(),
      meridians: [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150].map(meridian),
      parallels: [-60, -30, 30, 60].map(parallel),
      equator: parallel(0),
      tropics: [TROPIC, -TROPIC].map(parallel)
    }),
    []
  )

  const pad = 0.04
  const viewBox = [-EXTENT.x - pad, -EXTENT.y - pad, 2 * (EXTENT.x + pad), 2 * (EXTENT.y + pad)].join(' ')

  return (
    <section className="map" aria-label="Dünya haritası">
      <svg className="map__svg" viewBox={viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <radialGradient id="sea" cx="50%" cy="46%" r="62%">
            <stop offset="0%" stopColor="#13202b" />
            <stop offset="100%" stopColor="#0c131a" />
          </radialGradient>
          <clipPath id="sphere">
            <path d={paths.outline} />
          </clipPath>
        </defs>

        <path d={paths.outline} className="map__sphere" fill="url(#sea)" />
        <g clipPath="url(#sphere)">
          {paths.meridians.map((d, i) => (
            <path key={`m${i}`} d={d} className="map__grat" />
          ))}
          {paths.parallels.map((d, i) => (
            <path key={`p${i}`} d={d} className="map__grat" />
          ))}
          {paths.tropics.map((d, i) => (
            <path key={`t${i}`} d={d} className="map__tropic" />
          ))}
          <path d={paths.equator} className="map__equator" />
        </g>
        <path d={paths.outline} className="map__rim" />
      </svg>

      <div className="map__placard">
        <span className="eyebrow">Dünya haritası</span>
        <p>İller, sınırlar ve ülkeler bir sonraki aşamada burada açılacak.</p>
      </div>

      <div className="map__legend">Equal Earth</div>
      <div className="map__scale">Izgara 30°</div>
    </section>
  )
}
