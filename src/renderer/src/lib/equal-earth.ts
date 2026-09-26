// Equal Earth projection (Šavrič, Patterson & Jenny, 2018), same constants as d3-geo.
// Used for the placeholder graticule until the real map arrives in phase 1.

const A1 = 1.340264
const A2 = -0.081106
const A3 = 0.000893
const A4 = 0.003796
const M = Math.sqrt(3) / 2
const RAD = Math.PI / 180

/** Projects lon/lat in degrees to SVG coordinates (y grows downwards). */
export function project(lon: number, lat: number): [number, number] {
  const lambda = lon * RAD
  const theta = Math.asin(M * Math.sin(lat * RAD))
  const t2 = theta * theta
  const t6 = t2 * t2 * t2
  const x = (lambda * Math.cos(theta)) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)))
  const y = theta * (A1 + A2 * t2 + t6 * (A3 + A4 * t2))
  return [x, -y]
}

/** Half-width and half-height of the projected world, for the SVG viewBox. */
export const EXTENT = { x: project(180, 0)[0], y: -project(0, 90)[1] }

function line(points: Array<[number, number]>): string {
  return points
    .map(([lon, lat], i) => {
      const [x, y] = project(lon, lat)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(4)} ${y.toFixed(4)}`
    })
    .join('')
}

function range(from: number, to: number, step: number): number[] {
  const out: number[] = []
  for (let v = from; v <= to + 1e-9; v += step) out.push(v)
  return out
}

export function meridian(lon: number): string {
  return line(range(-90, 90, 2).map((lat) => [lon, lat]))
}

export function parallel(lat: number): string {
  return line(range(-180, 180, 2).map((lon) => [lon, lat]))
}

export function outline(): string {
  const east = range(-90, 90, 2).map((lat): [number, number] => [180, lat])
  const west = range(-90, 90, 2)
    .reverse()
    .map((lat): [number, number] => [-180, lat])
  return `${line([...east, ...west])}Z`
}
