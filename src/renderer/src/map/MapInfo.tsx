import { useEffect } from 'react'
import type { MapView } from '@shared/game/view'
import { countryColor, MAP_COUNTRIES } from './colors'
import type { MapSelection } from './MapView'

interface Props {
  selection: MapSelection
  game: MapView | undefined
  onSelect: (selection: MapSelection) => void
  onClose: () => void
}

/** What the map knows about the clicked country or province, read from GameState. */
export function MapInfo({ selection, game, onSelect, onClose }: Props): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const player = game?.player ?? 'TUR'
  const nameOf = (id: string): string => game?.countries.find((c) => c.id === id)?.name ?? MAP_COUNTRIES[id]?.name ?? id
  const swatch = (id: string) => <i className="map-info__swatch" style={{ background: countryColor(id, player) }} />

  const body = (() => {
    if (selection.kind === 'province') {
      const tracked = game?.provinces.find((p) => p.id === selection.id)
      const owner = tracked?.owner ?? selection.country
      const controller = tracked?.controller ?? owner
      return (
        <>
          <p className="map-info__kind">
            İl ·{' '}
            <button type="button" className="map-info__link" onClick={() => onSelect({ kind: 'country', id: selection.country, name: nameOf(selection.country), country: selection.country })}>
              {nameOf(selection.country)}
            </button>
          </p>
          <dl className="map-info__facts">
            <dt>Sahibi</dt>
            <dd>
              {swatch(owner)}
              {nameOf(owner)}
              {owner === player && ' (sen)'}
            </dd>
            <dt>Elinde tutan</dt>
            <dd>
              {swatch(controller)}
              {nameOf(controller)}
              {controller !== owner && <strong className="map-info__warn"> · işgal altında</strong>}
            </dd>
          </dl>
          {!tracked && <p className="map-info__note">Oyun bu ili ayrıca izlemiyor; haritadaki ülkesinin.</p>}
        </>
      )
    }
    const country = game?.countries.find((c) => c.id === selection.id)
    if (!country) {
      return (
        <>
          <p className="map-info__kind">Ülke</p>
          <p className="map-info__note">Şimdilik oyunun dışında: kendi hamlesini yapmaz, barları tutulmaz.</p>
        </>
      )
    }
    return (
      <>
        <p className="map-info__kind">
          {country.player ? 'Senin ülken' : 'Ülke'} · {country.regimeLabel}
        </p>
        {country.stance && (
          <p className="map-info__stance">
            Tutumu: <b>{country.stance}</b>
          </p>
        )}
        <ul className="map-info__bars">
          {country.bars.map((b) => (
            <li key={b.id}>
              <span>{b.label}</span>
              <span className="map-info__meter">
                <span style={{ width: `${b.value}%` }} />
              </span>
              <b>{b.value}</b>
            </li>
          ))}
        </ul>
        {!country.player && (
          <div className="map-info__ties">
            <span className="eyebrow">Aranızda yürürlükte</span>
            {country.ties.length === 0 ? <p className="map-info__note">Şu an bir şey yok.</p> : country.ties.map((t) => <p key={t}>{t}</p>)}
          </div>
        )}
      </>
    )
  })()

  return (
    <aside className="map-info hud-panel" aria-label={selection.name}>
      <header className="map-info__head">
        <h2>
          {swatch(selection.kind === 'country' ? selection.id : (game?.provinces.find((p) => p.id === selection.id)?.controller ?? selection.country))}
          {selection.kind === 'country' ? nameOf(selection.id) : selection.name}
        </h2>
        <button type="button" className="map-info__close" onClick={onClose} aria-label="Kapat">
          ×
        </button>
      </header>
      {body}
    </aside>
  )
}
