import { z } from 'zod'

// Building blocks shared by the game state, the effect catalog and the LLM contract.

export const BAR_IDS = ['economy', 'stability', 'approval', 'welfare', 'sovereignty', 'military', 'reputation'] as const
export const BarId = z.enum(BAR_IDS)
export type BarId = z.infer<typeof BarId>

export const BAR_LABELS: Record<BarId, string> = {
  economy: 'Ekonomi',
  stability: 'İstikrar',
  approval: 'Onay',
  welfare: 'Refah',
  sovereignty: 'Egemenlik',
  military: 'Askerî güç',
  reputation: 'İtibar'
}

/** A bar reading. Always an integer 0–100, and only code ever writes one. */
export const BarValue = z.int().min(0).max(100)
/** One value for every bar; zod requires all keys because the key schema is an enum. */
export const Bars = z.record(BarId, BarValue)
export type Bars = z.infer<typeof Bars>

export const CountryId = z.string().regex(/^[A-Z]{3}$/, 'ISO 3166-1 alpha-3 code, e.g. TUR')
export type CountryId = z.infer<typeof CountryId>

export const ProvinceId = z.string().regex(/^[A-Z]{2}-[A-Z0-9]{1,3}$/, 'ISO 3166-2 style code, e.g. TR-34')
export type ProvinceId = z.infer<typeof ProvinceId>

/** Anything in the world an event, effect or seed can be about. */
export const EntityRef = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('country'), id: CountryId }),
  z.strictObject({ type: z.literal('province'), id: ProvinceId })
])
export type EntityRef = z.infer<typeof EntityRef>

export const entityKey = (ref: EntityRef): string => `${ref.type}:${ref.id}`
export const countryRef = (id: string): EntityRef => ({ type: 'country', id })

/** Normalised tag as stored: ASCII lowercase kebab-case, e.g. "basin-ozgurlugu". */
export const Tag = z
  .string()
  .max(32)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase-kebab tag')
export type Tag = z.infer<typeof Tag>

export const IsoDate = z.iso.date()
export const Turn = z.int().min(0)
