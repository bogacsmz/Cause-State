import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl'

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
  shallow: '#172631',
  sea200: '#13212b',
  sea2000: '#101c25',
  sea4000: '#0d1820',
  land: '#222a30',
  border: '#56606a',
  province: '#46525d',
  river: '#1d3341',
  label: '#d8d0c0',
  labelSoft: '#9aa0a5',
  sea: '#58788c',
  halo: '#0b1015',
  city: '#e7dfcf',
  capital: '#dcbd7a'
}

// Natural Earth's MAPCOLOR9: a 1–9 colouring in which neighbours never share a value.
// Nine close, muted tones, so borders read without turning the map into a patchwork.
const COUNTRY_TONES = ['#252d33', '#29302b', '#2e2c28', '#2a2934', '#2b3130', '#302b2b', '#27303a', '#2d3029', '#2a2d31']
const countryTone = ['match', ['get', 'mc'], ...COUNTRY_TONES.flatMap((c, i) => [i + 1, c]), C.land] as unknown as ExpressionSpecification

const lerp = (...stops: number[]): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], ...stops] as unknown as ExpressionSpecification

export function mapStyle(): StyleSpecification {
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
        // Game ids as feature ids: feature-state recolouring by country and province (step 3).
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
      { id: 'land', type: 'fill', source: 'world', 'source-layer': 'countries', paint: { 'fill-color': countryTone } },
      {
        id: 'relief',
        type: 'raster',
        source: 'relief',
        paint: { 'raster-opacity': lerp(1, 0.55, 5, 0.45, 8, 0.3), 'raster-fade-duration': 0, 'raster-resampling': 'linear' }
      },
      { id: 'lakes', type: 'fill', source: 'physical', 'source-layer': 'lakes', paint: { 'fill-color': C.shallow } },
      {
        id: 'rivers',
        type: 'line',
        source: 'physical',
        'source-layer': 'rivers',
        paint: {
          'line-color': C.river,
          'line-width': ['interpolate', ['linear'], ['zoom'], 2, ['-', 1.1, ['*', ['get', 'sr'], 0.1]], 8, ['-', 2.4, ['*', ['get', 'sr'], 0.15]]]
        }
      },
      {
        id: 'province-lines',
        type: 'line',
        source: 'world',
        'source-layer': 'provinces',
        minzoom: 4,
        paint: { 'line-color': C.province, 'line-width': lerp(4, 0.4, 8, 1), 'line-opacity': lerp(4, 0, 4.6, 0.9) }
      },
      {
        id: 'country-lines',
        type: 'line',
        source: 'world',
        'source-layer': 'countries',
        layout: { 'line-join': 'round' },
        paint: { 'line-color': C.border, 'line-width': lerp(1, 0.5, 5, 1.1, 8, 1.8) }
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
        paint: { 'text-color': C.label, 'text-halo-color': C.halo, 'text-halo-width': 1.4, 'text-opacity': lerp(6, 1, 7.5, 0.55) }
      }
    ]
  }
}
