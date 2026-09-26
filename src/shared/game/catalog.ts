import { z } from 'zod'
import type { BarId } from './primitives'

// The effect catalog: everything the LLM is allowed to propose. The LLM picks an id and a
// target; every number below belongs to the code. It never sees or produces them.

export const EFFECT_IDS = [
  'fiscal_stimulus',
  'austerity',
  'tax_cut',
  'military_buildup',
  'press_crackdown',
  'anti_corruption_drive',
  'eu_accession_bid',
  'eu_membership',
  'regional_investment',
  'trade_agreement',
  'sanctions',
  'diplomatic_protest',
  'military_aid',
  'energy_cutoff',
  'foreign_investment'
] as const
export const EffectId = z.enum(EFFECT_IDS)
export type EffectId = z.infer<typeof EffectId>

/** Who may cause an effect: the player's government, or another country's (LLM-proposed intent). */
export type ActorKind = 'player' | 'foreign'

export interface Modifier {
  /** Which country the change lands on: the target, the acting country, or the owner of a target province. */
  on: 'target' | 'actor' | 'owner'
  bar: BarId
  delta: number
  /** 'once' hits when the effect starts; 'per_turn' repeats every turn while active. */
  mode: 'once' | 'per_turn'
}

export type EffectRule =
  | { kind: 'target_is_actor' }
  | { kind: 'target_not_actor' }
  | { kind: 'province_owned_by_actor' }
  | { kind: 'requires_active'; effectId: EffectId; on: 'actor' | 'target' }
  | { kind: 'forbids_active'; effectId: EffectId; on: 'actor' | 'target' }

export interface EffectDef {
  id: EffectId
  /** Turkish name shown in the game. */
  label: string
  /** What it represents, in words, for the LLM. Deliberately contains no numbers. */
  hint: string
  target: 'country' | 'province'
  actors: readonly ActorKind[]
  /** Political capital the player spends. Foreign actors don't pay. */
  cost: number
  /** null = stays until something removes it. */
  durationTurns: number | null
  /** At most one active copy per (actor, target). */
  unique: boolean
  rules: readonly EffectRule[]
  modifiers: readonly Modifier[]
  tags: readonly string[]
}

const DOMESTIC = [{ kind: 'target_is_actor' }] as const satisfies readonly EffectRule[]
const BILATERAL = [{ kind: 'target_not_actor' }] as const satisfies readonly EffectRule[]

export const EFFECTS: { readonly [K in EffectId]: EffectDef & { id: K } } = {
  fiscal_stimulus: {
    id: 'fiscal_stimulus',
    label: 'Mali teşvik paketi',
    hint: 'Government spending push: short-term growth and popularity, fiscal strain later.',
    target: 'country',
    actors: ['player'],
    cost: 2,
    durationTurns: 4,
    unique: true,
    rules: [...DOMESTIC, { kind: 'forbids_active', effectId: 'austerity', on: 'target' }],
    modifiers: [
      { on: 'target', bar: 'economy', delta: 2, mode: 'per_turn' },
      { on: 'target', bar: 'approval', delta: 3, mode: 'once' }
    ],
    tags: ['ekonomi']
  },
  austerity: {
    id: 'austerity',
    label: 'Kemer sıkma',
    hint: 'Spending cuts: slowly repairs the economy but hurts popularity and living standards.',
    target: 'country',
    actors: ['player'],
    cost: 2,
    durationTurns: 6,
    unique: true,
    rules: [...DOMESTIC, { kind: 'forbids_active', effectId: 'fiscal_stimulus', on: 'target' }],
    modifiers: [
      { on: 'target', bar: 'economy', delta: 1, mode: 'per_turn' },
      { on: 'target', bar: 'approval', delta: -6, mode: 'once' },
      { on: 'target', bar: 'welfare', delta: -2, mode: 'per_turn' }
    ],
    tags: ['ekonomi']
  },
  tax_cut: {
    id: 'tax_cut',
    label: 'Vergi indirimi',
    hint: 'Lower taxes: popular and mildly stimulating.',
    target: 'country',
    actors: ['player'],
    cost: 1,
    durationTurns: 3,
    unique: true,
    rules: DOMESTIC,
    modifiers: [
      { on: 'target', bar: 'approval', delta: 5, mode: 'once' },
      { on: 'target', bar: 'economy', delta: 1, mode: 'per_turn' }
    ],
    tags: ['ekonomi']
  },
  military_buildup: {
    id: 'military_buildup',
    label: 'Askerî yığınak',
    hint: 'Mobilisation and procurement: stronger armed forces, costly, worries neighbours.',
    target: 'country',
    actors: ['player', 'foreign'],
    cost: 2,
    durationTurns: 4,
    unique: true,
    rules: DOMESTIC,
    modifiers: [
      { on: 'target', bar: 'military', delta: 2, mode: 'per_turn' },
      { on: 'target', bar: 'economy', delta: -1, mode: 'per_turn' },
      { on: 'target', bar: 'reputation', delta: -2, mode: 'once' }
    ],
    tags: ['askeri']
  },
  press_crackdown: {
    id: 'press_crackdown',
    label: 'Basına baskı',
    hint: 'Censorship and pressure on media: short-term calm, long-term resentment and bad press abroad.',
    target: 'country',
    actors: ['player', 'foreign'],
    cost: 1,
    durationTurns: 6,
    unique: true,
    rules: DOMESTIC,
    modifiers: [
      { on: 'target', bar: 'stability', delta: 2, mode: 'once' },
      { on: 'target', bar: 'approval', delta: 2, mode: 'once' },
      { on: 'target', bar: 'reputation', delta: -4, mode: 'once' },
      { on: 'target', bar: 'welfare', delta: -1, mode: 'per_turn' }
    ],
    tags: ['ic-siyaset', 'sansur']
  },
  anti_corruption_drive: {
    id: 'anti_corruption_drive',
    label: 'Yolsuzlukla mücadele',
    hint: 'Investigations and purges of corrupt officials: popular, unsettles the establishment.',
    target: 'country',
    actors: ['player'],
    cost: 2,
    durationTurns: 4,
    unique: true,
    rules: DOMESTIC,
    modifiers: [
      { on: 'target', bar: 'approval', delta: 4, mode: 'once' },
      { on: 'target', bar: 'stability', delta: -2, mode: 'once' },
      { on: 'target', bar: 'economy', delta: 1, mode: 'per_turn' }
    ],
    tags: ['ic-siyaset']
  },
  eu_accession_bid: {
    id: 'eu_accession_bid',
    label: 'AB üyelik başvurusu',
    hint: 'Formally applying to join the European Union. A first step; membership itself comes later.',
    target: 'country',
    actors: ['player'],
    cost: 2,
    durationTurns: null,
    unique: true,
    rules: [...DOMESTIC, { kind: 'forbids_active', effectId: 'eu_membership', on: 'target' }],
    modifiers: [
      { on: 'target', bar: 'reputation', delta: 3, mode: 'once' },
      { on: 'target', bar: 'sovereignty', delta: -1, mode: 'once' }
    ],
    tags: ['ab', 'diplomasi']
  },
  eu_membership: {
    id: 'eu_membership',
    label: 'AB üyeliği',
    hint: 'Joining the European Union: trade and investment rise, sovereignty shrinks. Needs an accession bid first.',
    target: 'country',
    actors: ['player'],
    cost: 3,
    durationTurns: null,
    unique: true,
    rules: [...DOMESTIC, { kind: 'requires_active', effectId: 'eu_accession_bid', on: 'target' }],
    modifiers: [
      { on: 'target', bar: 'economy', delta: 1, mode: 'per_turn' },
      { on: 'target', bar: 'sovereignty', delta: -8, mode: 'once' },
      { on: 'target', bar: 'reputation', delta: 5, mode: 'once' }
    ],
    tags: ['ab', 'diplomasi', 'ekonomi']
  },
  regional_investment: {
    id: 'regional_investment',
    label: 'Bölgesel yatırım',
    hint: 'Infrastructure and jobs programme in one of your own provinces.',
    target: 'province',
    actors: ['player'],
    cost: 1,
    durationTurns: 4,
    unique: true,
    rules: [{ kind: 'province_owned_by_actor' }],
    modifiers: [
      { on: 'owner', bar: 'welfare', delta: 1, mode: 'per_turn' },
      { on: 'owner', bar: 'approval', delta: 1, mode: 'once' }
    ],
    tags: ['ekonomi', 'bolgesel']
  },
  trade_agreement: {
    id: 'trade_agreement',
    label: 'Ticaret anlaşması',
    hint: 'Bilateral trade deal: both economies benefit.',
    target: 'country',
    actors: ['player', 'foreign'],
    cost: 1,
    durationTurns: null,
    unique: true,
    rules: BILATERAL,
    modifiers: [
      { on: 'actor', bar: 'economy', delta: 1, mode: 'per_turn' },
      { on: 'target', bar: 'economy', delta: 1, mode: 'per_turn' }
    ],
    tags: ['ticaret', 'diplomasi']
  },
  sanctions: {
    id: 'sanctions',
    label: 'Yaptırım',
    hint: 'Economic sanctions against another country: hurts the target more than the sender.',
    target: 'country',
    actors: ['player', 'foreign'],
    cost: 2,
    durationTurns: 6,
    unique: true,
    rules: BILATERAL,
    modifiers: [
      { on: 'target', bar: 'economy', delta: -2, mode: 'per_turn' },
      { on: 'target', bar: 'reputation', delta: -1, mode: 'once' },
      { on: 'actor', bar: 'economy', delta: -1, mode: 'per_turn' }
    ],
    tags: ['yaptirim', 'diplomasi']
  },
  diplomatic_protest: {
    id: 'diplomatic_protest',
    label: 'Diplomatik nota',
    hint: 'A formal protest note: symbolic, small reputational cost for the target.',
    target: 'country',
    actors: ['player', 'foreign'],
    cost: 0,
    durationTurns: 1,
    unique: false,
    rules: BILATERAL,
    modifiers: [{ on: 'target', bar: 'reputation', delta: -1, mode: 'once' }],
    tags: ['diplomasi']
  },
  military_aid: {
    id: 'military_aid',
    label: 'Askerî yardım',
    hint: 'Weapons and training sent to another country.',
    target: 'country',
    actors: ['player', 'foreign'],
    cost: 1,
    durationTurns: 1,
    unique: false,
    rules: BILATERAL,
    modifiers: [
      { on: 'target', bar: 'military', delta: 3, mode: 'once' },
      { on: 'actor', bar: 'military', delta: -1, mode: 'once' }
    ],
    tags: ['askeri', 'diplomasi']
  },
  energy_cutoff: {
    id: 'energy_cutoff',
    label: 'Enerji kesintisi',
    hint: 'A supplier country cuts gas or oil deliveries to the target.',
    target: 'country',
    actors: ['foreign'],
    cost: 0,
    durationTurns: 6,
    unique: true,
    rules: BILATERAL,
    modifiers: [
      { on: 'target', bar: 'economy', delta: -2, mode: 'per_turn' },
      { on: 'target', bar: 'welfare', delta: -1, mode: 'per_turn' },
      { on: 'target', bar: 'stability', delta: -1, mode: 'once' }
    ],
    tags: ['enerji', 'ekonomi']
  },
  foreign_investment: {
    id: 'foreign_investment',
    label: 'Yabancı yatırım dalgası',
    hint: 'Companies from the acting country pour investment into the target.',
    target: 'country',
    actors: ['foreign'],
    cost: 0,
    durationTurns: 3,
    unique: true,
    rules: BILATERAL,
    modifiers: [{ on: 'target', bar: 'economy', delta: 2, mode: 'per_turn' }],
    tags: ['ekonomi', 'yatirim']
  }
}

/** Compact catalog for the LLM's (cached) system prompt: ids and words only, never numbers. */
export function catalogForPrompt(): Array<Pick<EffectDef, 'id' | 'hint' | 'target' | 'actors'>> {
  return EFFECT_IDS.map((id) => {
    const { hint, target, actors } = EFFECTS[id]
    return { id, hint, target, actors }
  })
}
