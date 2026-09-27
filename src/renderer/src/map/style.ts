import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl'
import { COUNTRY_PALETTE, PLAYER_COLORS } from './colors'

// The map's look. Everything it draws comes from the game's own files over cs-map://
// (tiles and label glyphs), so it works offline. Level of detail follows the tiles: a
// feature only exists from its min zoom on (see map/build.mjs), and the style adds the
// zoom-by-zoom sizes and fades.

/** One place for the projection. Flat Web Mercator now; a globe later is a one-word change. */
export const MAP_PROJECTION = 'mercator' as const

export const MAP_LIMITS = { minZoom: 1, maxZoom: 10 }

/** Türkiye first: the game's home view. */
export const HOME_VIEW = { center: [35.2, 39.1] as [number, number], zoom: 4.6 }

const TILES = 'cs-map://tiles'
const FONT_REGULAR = ['Noto Sans Regular']
const FONT_MEDIUM = ['Noto Sans Medium']
const FONT_ITALIC = ['Noto Sans Italic']

const C = {
  shallow: '#172833',
  sea200: '#14232d',
  sea2000: '#111e27',
  sea4000: '#0f1a22',
  border: '#0b1015',
  river: '#2a4657',
  label: '#efe8da',
  labelSoft: '#d6cfc2',
  sea: '#5d7d91',
  halo: '#0b1015',
  city: '#f1eadc',
  capital: '#f3dfa6',
  selected: '#f7f2e8'
}

// Political first: every country in one of nine muted hues by its MAPCOLOR9 slot, the
// player's country in gold (feature-state `player`). The relief stays a faint texture.
const countryTone = ['match', ['get', 'mc'], ...COUNTRY_PALETTE.flatMap((c, i) => [i + 1, c]), COUNTRY_PALETTE[0]] as unknown as ExpressionSpecification
const isPlayerFeature = ['boolean', ['feature-state', 'player'], false] as unknown as ExpressionSpecification

const lerp = (...stops: number[]): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], ...stops] as unknown as ExpressionSpecification

/** Name of the diagonal-stripe image for occupied provinces (drawn by MapView, see hatchImage). */
export const HATCH = 'hatch'

/** Layers that read the player's id from the tiles (`cid`); MapView updates them when it changes. */
export function playerExpressions(player: string) {
  const mine = ['==', ['get', 'cid'], player] as unknown as ExpressionSpecification
  return {
    playerBorderFilter: mine,
    provinceLineColor: ['case', mine, 'rgba(70, 48, 12, 0.55)', 'rgba(8, 12, 16, 0.42)'] as unknown as ExpressionSpecification,
    countryLabelColor: ['case', mine, PLAYER_COLORS.label, C.label] as unknown as ExpressionSpecification
  }
}

export function mapStyle(player: string): StyleSpecification {
  const p = playerExpressions(player)
  return {
    version: 8,
    projection: { type: MAP_PROJECTION },
    glyphs: 'cs-map://fonts/{fontstack}/{range}.pbf',
    sources: {
      world: {
        type: 'vector',
        tiles: [`${TILES}/world/{z}/{x}/{y}`],
        minzoom: 0,
        maxzoom: 8,
        attribution: 'Natural Earth',
        // Game ids as feature ids: GameState recolours countries and provinces by feature-state.
        promoteId: { countries: 'cid', provinces: 'pid' }
      },
      physical: { type: 'vector', tiles: [`${TILES}/physical/{z}/{x}/{y}`], minzoom: 0, maxzoom: 6 },
      relief: { type: 'raster', tiles: [`${TILES}/relief/{z}/{x}/{y}`], tileSize: 512, minzoom: 0, maxzoom: 4 }
    },
    layers: [
      { id: 'sea', type: 'background', paint: { 'background-color': C.shallow } },
      {
        id: 'sea-depth',
        type: 'fill',
        source: 'physical',
        'source-layer': 'depth',
        paint: {
          'fill-color': ['match', ['get', 'd'], 200, C.sea200, 2000, C.sea2000, C.sea4000],
          'fill-opacity': lerp(4, 1, 6, 0),
          'fill-antialias': false
        }
      },
      {
        id: 'land',
        type: 'fill',
        source: 'world',
        'source-layer': 'countries',
        paint: { 'fill-color': ['case', isPlayerFeature, PLAYER_COLORS.fill, countryTone] as unknown as ExpressionSpecification }
      },
      {
        id: 'relief',
        type: 'raster',
        source: 'relief',
        paint: { 'raster-opacity': lerp(1, 0.14, 5, 0.1, 8, 0.06), 'raster-fade-duration': 0, 'raster-resampling': 'linear' }
      },
      // Provinces whose holder is not the country they lie in: the holder's colour (feature-state `fill`).
      {
        id: 'province-fill',
        type: 'fill',
        source: 'world',
        'source-layer': 'provinces',
        minzoom: 4,
        paint: { 'fill-color': ['to-color', ['coalesce', ['feature-state', 'fill'], 'rgba(0, 0, 0, 0)']] as unknown as ExpressionSpecification }
      },
      // Held by someone other than the legal owner: striped (feature-state `occupied`).
      {
        id: 'province-occupied',
        type: 'fill',
        source: 'world',
        'source-layer': 'provinces',
        minzoom: 4,
        paint: { 'fill-pattern': HATCH, 'fill-opacity': ['case', ['boolean', ['feature-state', 'occupied'], false], 1, 0] as unknown as ExpressionSpecification }
      },
      { id: 'lakes', type: 'fill', source: 'physical', 'source-layer': 'lakes', paint: { 'fill-color': C.shallow } },
      {
        id: 'rivers',
        type: 'line',
        source: 'physical',
        'source-layer': 'rivers',
        paint: {
          'line-color': C.river,
          'line-opacity': 0.8,
          'line-width': ['interpolate', ['linear'], ['zoom'], 2, ['-', 1.1, ['*', ['get', 'sr'], 0.1]], 8, ['-', 2.4, ['*', ['get', 'sr'], 0.15]]]
        }
      },
      {
        id: 'province-lines',
        type: 'line',
        source: 'world',
        'source-layer': 'provinces',
        minzoom: 4,
        paint: { 'line-color': p.provinceLineColor, 'line-width': lerp(4, 0.4, 8, 1), 'line-opacity': lerp(4, 0, 4.6, 1) }
      },
      {
        id: 'country-lines',
        type: 'line',
        source: 'world',
        'source-layer': 'countries',
        layout: { 'line-join': 'round' },
        paint: { 'line-color': C.border, 'line-width': lerp(1, 0.6, 5, 1.3, 8, 2) }
      },
      {
        id: 'player-glow',
        type: 'line',
        source: 'world',
        'source-layer': 'countries',
        filter: p.playerBorderFilter,
        layout: { 'line-join': 'round' },
        paint: { 'line-color': PLAYER_COLORS.border, 'line-width': lerp(1, 4, 5, 8, 8, 12), 'line-blur': lerp(1, 3, 5, 6, 8, 9), 'line-opacity': 0.35 }
      },
      {
        id: 'player-border',
        type: 'line',
        source: 'world',
        'source-layer': 'countries',
        filter: p.playerBorderFilter,
        layout: { 'line-join': 'round' },
        paint: { 'line-color': PLAYER_COLORS.border, 'line-width': lerp(1, 1.2, 5, 2.2, 8, 3) }
      },
      // What the player clicked (feature-state `selected`).
      {
        id: 'selected-country',
        type: 'line',
        source: 'world',
        'source-layer': 'countries',
        layout: { 'line-join': 'round' },
        paint: { 'line-color': C.selected, 'line-width': lerp(1, 1.5, 6, 3), 'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, 0] as unknown as ExpressionSpecification }
      },
      {
        id: 'selected-province',
        type: 'line',
        source: 'world',
        'source-layer': 'provinces',
        minzoom: 4,
        layout: { 'line-join': 'round' },
        paint: { 'line-color': C.selected, 'line-width': lerp(4, 1.5, 8, 3), 'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, 0] as unknown as ExpressionSpecification }
      },
      {
        id: 'sea-labels',
        type: 'symbol',
        source: 'physical',
        'source-layer': 'sea_labels',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': FONT_ITALIC,
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, ['-', 12, ['get', 'sr']], 6, ['-', 15, ['*', 0.5, ['get', 'sr']]]],
          'text-letter-spacing': 0.12,
          'text-max-width': 7,
          'symbol-sort-key': ['get', 'sr']
        },
        paint: { 'text-color': C.sea, 'text-halo-color': C.halo, 'text-halo-width': 1 }
      },
      {
        id: 'province-labels',
        type: 'symbol',
        source: 'world',
        'source-layer': 'province_labels',
        minzoom: 5,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': FONT_REGULAR,
          'text-size': lerp(5, 10, 8, 13),
          'text-max-width': 7,
          'symbol-sort-key': ['get', 'lr']
        },
        paint: { 'text-color': C.labelSoft, 'text-halo-color': C.halo, 'text-halo-width': 1.2, 'text-opacity': lerp(5, 0, 5.4, 1) }
      },
      {
        id: 'city-dots',
        type: 'circle',
        source: 'world',
        'source-layer': 'cities',
        paint: {
          'circle-radius': ['match', ['get', 'cap'], 2, 3.2, 1, 2.4, 1.8],
          'circle-color': ['match', ['get', 'cap'], 2, C.capital, C.city],
          'circle-stroke-color': C.halo,
          'circle-stroke-width': 1
        }
      },
      {
        id: 'city-labels',
        type: 'symbol',
        source: 'world',
        'source-layer': 'cities',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['match', ['get', 'cap'], 2, ['literal', FONT_MEDIUM], ['literal', FONT_REGULAR]],
          'text-size': ['interpolate', ['linear'], ['zoom'], 3, ['match', ['get', 'cap'], 2, 11, 10], 8, ['-', 15, ['*', 0.4, ['get', 'sr']]]],
          'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
          'text-radial-offset': 0.55,
          'text-justify': 'auto',
          // Capitals and big cities win when labels collide.
          'symbol-sort-key': ['-', ['get', 'sr'], ['*', 3, ['get', 'cap']]]
        },
        paint: { 'text-color': ['match', ['get', 'cap'], 2, C.capital, C.city], 'text-halo-color': C.halo, 'text-halo-width': 1.3 }
      },
      {
        id: 'country-labels',
        type: 'symbol',
        source: 'world',
        'source-layer': 'country_labels',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': FONT_MEDIUM,
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, ['-', 13, ['get', 'lr']], 5, ['-', 18, ['get', 'lr']]],
          'text-letter-spacing': 0.08,
          'text-max-width': 8,
          'symbol-sort-key': ['get', 'lr']
        },
        paint: { 'text-color': p.countryLabelColor, 'text-halo-color': C.halo, 'text-halo-width': 1.5, 'text-opacity': lerp(6, 1, 7.5, 0.55) }
      }
    ]
  }
}
