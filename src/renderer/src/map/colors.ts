import countriesJson from '../../../../map/countries.json'

// Political colours. Every country gets one of nine hues by its Natural Earth MAPCOLOR9
// slot (neighbours never share a slot), all at the same muted lightness, so borders read
// at a glance and no country shouts. The player's country is the one bright, warm colour.

export interface MapCountryInfo {
  name: string
  /** Natural Earth MAPCOLOR9 slot, 1–9. */
  mc: number
  /** [west, south, east, north] of its main part. */
  bounds: [number, number, number, number]
}

/** Every country on the map (map/countries.json, written by the map build). */
export const MAP_COUNTRIES = countriesJson as unknown as Record<string, MapCountryInfo>

/** Nine hues 40° apart-ish, HSL lightness 40 %, saturation 30 %. */
export const COUNTRY_PALETTE = ['#476485', '#5c8547', '#856447', '#754785', '#47857c', '#854750', '#857c47', '#4c4785', '#47855a'] as const

export const PLAYER_COLORS = { fill: '#cba14d', border: '#efd28f', label: '#f3dfa6' }

/** A country's map colour: its hue slot, or the player's gold. */
export function countryColor(id: string, player: string): string {
  if (id === player) return PLAYER_COLORS.fill
  const slot = MAP_COUNTRIES[id]?.mc ?? 1
  return COUNTRY_PALETTE[(slot - 1 + COUNTRY_PALETTE.length) % COUNTRY_PALETTE.length]!
}
