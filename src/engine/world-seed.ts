import type { Country, Province } from '@shared/game/schema'

// Starting world for early phases: a handful of countries and provinces, enough to
// exercise the contract. Bar values and election dates are rough placeholders for
// January 2026; the frozen "world book" in phase 2 replaces them with researched data.

/** Bars are also each country's starting anchors (see Country.anchors). */
export const START_COUNTRIES: ReadonlyArray<Omit<Country, 'anchors'>> = [
  {
    id: 'TUR',
    name: 'Türkiye',
    regime: 'hybrid',
    nextElection: '2028-05-14',
    bars: { economy: 46, stability: 52, approval: 45, welfare: 44, sovereignty: 80, military: 72, reputation: 50 }
  },
  {
    id: 'GRC',
    name: 'Yunanistan',
    regime: 'democracy',
    nextElection: '2027-06-01',
    bars: { economy: 55, stability: 66, approval: 48, welfare: 58, sovereignty: 62, military: 55, reputation: 62 }
  },
  {
    id: 'USA',
    name: 'Amerika Birleşik Devletleri',
    regime: 'democracy',
    nextElection: '2028-11-07',
    bars: { economy: 70, stability: 55, approval: 42, welfare: 66, sovereignty: 92, military: 97, reputation: 58 }
  },
  {
    id: 'RUS',
    name: 'Rusya',
    regime: 'authoritarian',
    nextElection: '2030-03-17',
    bars: { economy: 42, stability: 60, approval: 68, welfare: 45, sovereignty: 90, military: 88, reputation: 22 }
  },
  {
    id: 'DEU',
    name: 'Almanya',
    regime: 'democracy',
    nextElection: '2029-02-23',
    bars: { economy: 58, stability: 70, approval: 38, welfare: 72, sovereignty: 65, military: 50, reputation: 70 }
  },
  {
    id: 'FRA',
    name: 'Fransa',
    regime: 'democracy',
    nextElection: '2027-04-10',
    bars: { economy: 54, stability: 52, approval: 30, welfare: 70, sovereignty: 66, military: 70, reputation: 66 }
  },
  {
    id: 'IRN',
    name: 'İran',
    regime: 'authoritarian',
    nextElection: '2028-06-01',
    bars: { economy: 30, stability: 45, approval: 35, welfare: 34, sovereignty: 85, military: 64, reputation: 20 }
  },
  {
    id: 'CHN',
    name: 'Çin',
    regime: 'authoritarian',
    nextElection: null,
    bars: { economy: 68, stability: 72, approval: 62, welfare: 55, sovereignty: 95, military: 90, reputation: 45 }
  },
  {
    id: 'GBR',
    name: 'Birleşik Krallık',
    regime: 'democracy',
    nextElection: '2029-08-01',
    bars: { economy: 60, stability: 62, approval: 36, welfare: 68, sovereignty: 80, military: 78, reputation: 64 }
  },
  {
    id: 'UKR',
    name: 'Ukrayna',
    regime: 'democracy',
    nextElection: null,
    bars: { economy: 25, stability: 30, approval: 55, welfare: 30, sovereignty: 45, military: 70, reputation: 60 }
  },
  {
    id: 'SYR',
    name: 'Suriye',
    regime: 'hybrid',
    nextElection: null,
    bars: { economy: 12, stability: 20, approval: 40, welfare: 12, sovereignty: 25, military: 28, reputation: 30 }
  },
  {
    id: 'IRQ',
    name: 'Irak',
    regime: 'hybrid',
    nextElection: '2029-11-01',
    bars: { economy: 40, stability: 38, approval: 35, welfare: 35, sovereignty: 45, military: 45, reputation: 35 }
  },
  {
    id: 'ISR',
    name: 'İsrail',
    regime: 'democracy',
    nextElection: '2026-10-27',
    bars: { economy: 62, stability: 45, approval: 38, welfare: 66, sovereignty: 85, military: 85, reputation: 35 }
  },
  {
    id: 'SAU',
    name: 'Suudi Arabistan',
    regime: 'authoritarian',
    nextElection: null,
    bars: { economy: 66, stability: 70, approval: 60, welfare: 62, sovereignty: 85, military: 66, reputation: 50 }
  },
  {
    id: 'AZE',
    name: 'Azerbaycan',
    regime: 'authoritarian',
    nextElection: '2031-02-01',
    bars: { economy: 50, stability: 68, approval: 60, welfare: 48, sovereignty: 78, military: 60, reputation: 45 }
  },
  {
    id: 'EGY',
    name: 'Mısır',
    regime: 'authoritarian',
    nextElection: '2030-12-01',
    bars: { economy: 34, stability: 50, approval: 40, welfare: 32, sovereignty: 70, military: 70, reputation: 42 }
  }
]

export const START_PROVINCES: readonly Province[] = [
  { id: 'TR-06', name: 'Ankara', owner: 'TUR', controller: 'TUR' },
  { id: 'TR-34', name: 'İstanbul', owner: 'TUR', controller: 'TUR' },
  { id: 'TR-35', name: 'İzmir', owner: 'TUR', controller: 'TUR' },
  { id: 'TR-01', name: 'Adana', owner: 'TUR', controller: 'TUR' },
  { id: 'TR-07', name: 'Antalya', owner: 'TUR', controller: 'TUR' },
  { id: 'TR-21', name: 'Diyarbakır', owner: 'TUR', controller: 'TUR' },
  { id: 'TR-27', name: 'Gaziantep', owner: 'TUR', controller: 'TUR' },
  { id: 'TR-31', name: 'Hatay', owner: 'TUR', controller: 'TUR' },
  { id: 'TR-61', name: 'Trabzon', owner: 'TUR', controller: 'TUR' },
  { id: 'GR-I', name: 'Attika', owner: 'GRC', controller: 'GRC' }
]
