import { z } from 'zod'
import { CATALOG_EFFECT_IDS, EFFECTS, PLAYER_EFFECT_IDS } from '@shared/game/catalog'
import { BAR_IDS } from '@shared/game/primitives'
import { START_COUNTRIES, START_PROVINCES } from '../../../engine/world-seed'

// What Claude writes back, as schemas. Deliberately loose: ids are enums so Claude can only
// name things that exist, but lengths, budgets and every game rule are left to the referee,
// which checks the full contract (src/shared/game/contract.ts) before anything is applied.

const CountryIdWire = z.enum(START_COUNTRIES.map((c) => c.id) as [string, ...string[]])
const ProvinceIdWire = z.enum(START_PROVINCES.map((p) => p.id) as [string, ...string[]])
const EffectIdWire = z.enum(CATALOG_EFFECT_IDS as [string, ...string[]])
/** Moves someone other than the player's government may make (another country, or society and the world). */
const WorldEffectIdWire = z.enum(CATALOG_EFFECT_IDS.filter((id) => EFFECTS[id].actors.some((a) => a !== 'player')) as [string, ...string[]])

/** An improvised change in words; the code turns it into numbers. */
const ImpactWire = z.object({
  bar: z.enum(BAR_IDS),
  change: z.enum(['up', 'down']),
  size: z.enum(['small', 'clear', 'large']),
  monthly: z.boolean()
})
const LastsWire = z.enum(['month', 'season', 'half_year'])
const PlayerEffectIdWire = z.enum(PLAYER_EFFECT_IDS as [string, ...string[]])

const TargetWire = z.discriminatedUnion('type', [
  z.object({ type: z.literal('country'), id: CountryIdWire }),
  z.object({ type: z.literal('province'), id: ProvinceIdWire })
])

/** The cabinet's answer to one typed message: talk (free) or an action (catalog moves). */
export const OrderReplyWire = z.object({
  kind: z.enum(['talk', 'action']),
  /** Turkish, streamed to the player as it is written. */
  reply: z.string(),
  decisions: z.array(z.object({ effectId: PlayerEffectIdWire, target: TargetWire, reason: z.string() })),
  /** Moves the reply talks about ("what if…"), so the game can show their real numbers. */
  discussed: z.array(PlayerEffectIdWire)
})
export type OrderReplyWire = z.infer<typeof OrderReplyWire>

const ConditionWire = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('bar_low'), country: CountryIdWire, bar: z.enum(BAR_IDS) }),
  z.object({ kind: z.literal('effect_active'), effectId: EffectIdWire, country: CountryIdWire })
])

/**
 * The world's answer for one month: reactions to the player's moves, the world's own
 * development (when the code planned one), consequences coming back, new seeds.
 */
export const WorldReplyWire = z.object({
  interpretation: z.string(),
  reactions: z.array(z.object({ actor: CountryIdWire, effectId: WorldEffectIdWire, target: TargetWire, reason: z.string() })),
  development: z
    .object({
      title: z.string(),
      story: z.string(),
      actor: CountryIdWire.nullable(),
      target: CountryIdWire,
      moves: z.array(WorldEffectIdWire),
      impacts: z.array(ImpactWire),
      lasts: LastsWire
    })
    .nullable(),
  consequences: z.array(
    z.object({
      seedId: z.string(),
      title: z.string(),
      reason: z.string(),
      actor: CountryIdWire.nullable(),
      effectId: WorldEffectIdWire.nullable(),
      target: TargetWire.nullable(),
      impacts: z.array(ImpactWire),
      lasts: LastsWire
    })
  ),
  newSeeds: z.array(
    z.object({
      source: EffectIdWire.nullable(),
      hook: z.string(),
      entities: z.array(TargetWire),
      tags: z.array(z.string()),
      dormancy: z.enum(['short', 'medium', 'long']),
      likelihood: z.enum(['unlikely', 'possible', 'likely']),
      condition: ConditionWire.nullable()
    })
  )
})
export type WorldReplyWire = z.infer<typeof WorldReplyWire>

/**
 * JSON Schema for structured output. Every object is closed and every field required, the
 * shape both the CLI (--json-schema) and the API (output_config.format) accept.
 */
export function wireJsonSchema(schema: z.ZodType): Record<string, unknown> {
  // Repeated parts (the effect and country lists) become $defs, keeping the schema short.
  const raw = z.toJSONSchema(schema, { target: 'draft-2020-12', reused: 'ref' }) as Record<string, unknown>
  delete raw.$schema
  return closeObjects(raw) as Record<string, unknown>
}

function closeObjects(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(closeObjects)
  if (node === null || typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) out[key] = closeObjects(value)
  if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
    out.additionalProperties = false
    out.required = Object.keys(out.properties)
  }
  return out
}

export const ORDER_REPLY_SCHEMA = wireJsonSchema(OrderReplyWire)
export const WORLD_REPLY_SCHEMA = wireJsonSchema(WorldReplyWire)

/** Capital cost of a set of decisions, for telling Claude what is left. */
export function costOf(ids: readonly (keyof typeof EFFECTS)[]): number {
  return ids.reduce((n, id) => n + EFFECTS[id].cost, 0)
}
