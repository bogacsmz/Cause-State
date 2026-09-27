import adjacencyJson from '../../../map/adjacency.json'

// Land borders between provinces and between countries, from the map's own polygons
// (map/adjacency.json, built by map/adjacency.mjs). The groundwork for moving and occupying
// province by province; this module only answers questions, it holds no rules.
//
// A province touching a province of another country means the two countries border each
// other too (the build guarantees it), so a march from province to province never crosses
// a border the country graph does not know.

type Graph = Record<string, Record<string, number>>
const graph = adjacencyJson as unknown as { countries: Graph; provinces: Graph }

/** Provinces sharing a land border with `id` (ISO 3166-2 like "TR-31", or Natural Earth's code). */
export function provinceNeighbors(id: string): string[] {
  return Object.keys(graph.provinces[id] ?? {})
}

/** Countries sharing a land border with `id` (Natural Earth ADM0_A3, e.g. "TUR"). */
export function countryNeighbors(id: string): string[] {
  return Object.keys(graph.countries[id] ?? {})
}

export function areProvincesAdjacent(a: string, b: string): boolean {
  return a !== b && graph.provinces[a]?.[b] !== undefined
}

export function areCountriesAdjacent(a: string, b: string): boolean {
  return a !== b && graph.countries[a]?.[b] !== undefined
}

/**
 * Length of the shared land border in km (approximate: measured on the map's simplified
 * outlines, about four fifths of the surveyed figure), or null where there is none.
 */
export function borderKm(a: string, b: string): number | null {
  return graph.provinces[a]?.[b] ?? graph.countries[a]?.[b] ?? null
}

/** Whether the map knows the id at all (province or country). */
export function isOnMap(id: string): boolean {
  return id in graph.provinces || id in graph.countries
}
