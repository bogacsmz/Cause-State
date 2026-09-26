import { z } from 'zod'
import type { BarId } from './primitives'

// The effect catalog: everything that can happen in the world. The LLM picks an id and a
// target; every number below belongs to the code. The LLM never sees or produces them.
// The player does see them: the cards show exactly what a decision will do.

export const EFFECT_IDS = [
  // player decisions
  'tax_cut',
  'fiscal_stimulus',
  'austerity',
  'regional_investment',
  'anti_corruption_drive',
  'press_crackdown',
  'eu_accession_bid',
  'eu_membership',
  'trade_agreement',
  'sanctions',
  'diplomatic_protest',
  'military_aid',
  'military_buildup',
  // what other countries do
  'energy_cutoff',
  'foreign_investment',
  'eu_process_frozen',
  'eu_funds',
  // what society and the world do (mostly delayed consequences, i.e. fired seeds)
  'protest_wave',
  'inflation_spike',
  'budget_gap',
  'elite_backlash',
  'nationalist_backlash',
  'investor_confidence',
  'regional_boom',
  'regional_tension'
] as const
export const EffectId = z.enum(EFFECT_IDS)
export type EffectId = z.infer<typeof EffectId>

/** Who may cause an effect: the player's government, another country, or society/the world itself. */
export type ActorKind = 'player' | 'foreign' | 'world'

export type EffectCategory = 'economy' | 'domestic' | 'foreign' | 'military' | 'world'

export const CATEGORY_LABELS: Record<EffectCategory, string> = {
  economy: 'Ekonomi',
  domestic: 'İç siyaset',
  foreign: 'Dış politika',
  military: 'Askerî',
  world: 'Dünya'
}

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
  /** The acting country may have at most this many copies running at once. */
  | { kind: 'max_active'; count: number }

export interface EffectDef {
  id: EffectId
  /** Turkish name shown in the game. */
  label: string
  /** One Turkish line for the decision card: what it is, and its catch. */
  summary: string
  /** What it represents, in words, for the LLM. Deliberately contains no numbers. */
  hint: string
  category: EffectCategory
  target: 'country' | 'province'
  actors: readonly ActorKind[]
  /** Political capital the player spends. Others don't pay. */
  cost: number
  /** How many turns it stays active; null = until removed. */
  durationTurns: number | null
  /** At most one active copy per (actor, target). Consequences are not unique: they stack. */
  unique: boolean
  rules: readonly EffectRule[]
  modifiers: readonly Modifier[]
  tags: readonly string[]
}

const DOMESTIC = [{ kind: 'target_is_actor' }] as const satisfies readonly EffectRule[]
const BILATERAL = [{ kind: 'target_not_actor' }] as const satisfies readonly EffectRule[]

const once = (bar: BarId, delta: number, on: Modifier['on'] = 'target'): Modifier => ({ on, bar, delta, mode: 'once' })
const perTurn = (bar: BarId, delta: number, on: Modifier['on'] = 'target'): Modifier => ({ on, bar, delta, mode: 'per_turn' })

export const EFFECTS: { readonly [K in EffectId]: EffectDef & { id: K } } = {
  tax_cut: {
    id: 'tax_cut',
    label: 'Vergi indirimi',
    summary: 'Halk hemen sevinir, cepler rahatlar. Kasa zayıflar; bütçe bunun hesabını ileride sorabilir.',
    hint: 'Lower taxes: an immediate popularity boost and more money in pockets, at a fiscal cost now and later.',
    category: 'economy',
    target: 'country',
    actors: ['player'],
    cost: 1,
    durationTurns: 4,
    unique: true,
    rules: DOMESTIC,
    modifiers: [once('approval', 5), perTurn('welfare', 1), perTurn('economy', -1)],
    tags: ['ekonomi', 'vergi']
  },
  fiscal_stimulus: {
    id: 'fiscal_stimulus',
    label: 'Mali teşvik paketi',
    summary: 'Ekonomiyi hızla büyütür, piyasalar kaşlarını kaldırır. Para basmanın bedeli enflasyon olarak dönebilir.',
    hint: 'Government spending push: fast growth now, inflation risk later.',
    category: 'economy',
    target: 'country',
    actors: ['player'],
    cost: 1,
    durationTurns: 3,
    unique: true,
    rules: [...DOMESTIC, { kind: 'forbids_active', effectId: 'austerity', on: 'target' }],
    modifiers: [perTurn('economy', 2), once('approval', 1), once('reputation', -1)],
    tags: ['ekonomi', 'tesvik']
  },
  austerity: {
    id: 'austerity',
    label: 'Kemer sıkma',
    summary: 'Halk sıkıntı çeker, onay düşer. Ekonomi yavaş toparlanır, piyasalar bunu ödüllendirebilir.',
    hint: 'Spending cuts: painful and unpopular now, slowly repairs the economy, may win investor trust.',
    category: 'economy',
    target: 'country',
    actors: ['player'],
    cost: 1,
    durationTurns: 5,
    unique: true,
    rules: [...DOMESTIC, { kind: 'forbids_active', effectId: 'fiscal_stimulus', on: 'target' }],
    modifiers: [once('approval', -4), perTurn('welfare', -2), perTurn('economy', 2)],
    tags: ['ekonomi', 'kemer-sikma']
  },
  regional_investment: {
    id: 'regional_investment',
    label: 'Bölgesel yatırım',
    summary: 'Bir ilinde altyapı ve iş. Kasadan çıkarken refahı artırır; meyvesini ileride verebilir. Aynı anda tek il.',
    hint: 'Infrastructure and jobs programme in one of your own provinces.',
    category: 'economy',
    target: 'province',
    actors: ['player'],
    cost: 1,
    durationTurns: 4,
    unique: true,
    rules: [{ kind: 'province_owned_by_actor' }, { kind: 'max_active', count: 1 }],
    modifiers: [perTurn('economy', -1, 'owner'), perTurn('welfare', 1, 'owner'), once('approval', 1, 'owner')],
    tags: ['ekonomi', 'bolgesel']
  },
  anti_corruption_drive: {
    id: 'anti_corruption_drive',
    label: 'Yolsuzlukla mücadele',
    summary: 'Halk alkışlar, ekonomi rahatlar ama düzen sarsılır. Koltuklarını kaybedenler sessiz kalmayabilir.',
    hint: 'Investigations and purges of corrupt officials: popular, unsettles the establishment.',
    category: 'domestic',
    target: 'country',
    actors: ['player'],
    cost: 1,
    durationTurns: 5,
    unique: true,
    rules: DOMESTIC,
    modifiers: [once('approval', 4), once('stability', -3), perTurn('economy', 1)],
    tags: ['ic-siyaset', 'yolsuzluk']
  },
  press_crackdown: {
    id: 'press_crackdown',
    label: 'Basına baskı',
    summary: 'Kısa vadede sükûnet. Halk küser, dışarıda itibar kaybı; biriken öfke bir gün patlayabilir.',
    hint: 'Censorship and pressure on media: short-term calm, long-term resentment and bad press abroad.',
    category: 'domestic',
    target: 'country',
    actors: ['player', 'foreign'],
    cost: 1,
    durationTurns: 4,
    unique: true,
    rules: DOMESTIC,
    modifiers: [once('stability', 4), once('approval', -1), once('reputation', -4), perTurn('welfare', -1)],
    tags: ['ic-siyaset', 'sansur']
  },
  eu_accession_bid: {
    id: 'eu_accession_bid',
    label: 'AB üyelik başvurusu',
    summary: 'Dünyada itibar kazandırır. Üyeliğe giden uzun yol; bazı başkentler buna sıcak bakmaz.',
    hint: 'Formally applying to join the European Union. A first step; membership itself comes later.',
    category: 'foreign',
    target: 'country',
    actors: ['player'],
    cost: 1,
    durationTurns: null,
    unique: true,
    rules: [...DOMESTIC, { kind: 'forbids_active', effectId: 'eu_membership', on: 'target' }],
    modifiers: [once('reputation', 3), once('sovereignty', -2), once('approval', 1)],
    tags: ['ab', 'diplomasi']
  },
  eu_membership: {
    id: 'eu_membership',
    label: 'AB üyeliği',
    summary: 'Ekonomi kalıcı olarak güçlenir, egemenlik belirgin biçimde azalır. Önce başvuru gerekir.',
    hint: 'Joining the European Union: trade and investment rise, sovereignty shrinks. Needs an accession bid first.',
    category: 'foreign',
    target: 'country',
    actors: ['player'],
    cost: 1,
    durationTurns: null,
    unique: true,
    rules: [
      ...DOMESTIC,
      { kind: 'requires_active', effectId: 'eu_accession_bid', on: 'target' },
      { kind: 'forbids_active', effectId: 'eu_process_frozen', on: 'target' }
    ],
    modifiers: [perTurn('economy', 1), once('sovereignty', -8), once('reputation', 5), once('approval', -2)],
    tags: ['ab', 'diplomasi', 'ekonomi']
  },
  trade_agreement: {
    id: 'trade_agreement',
    label: 'Ticaret anlaşması',
    summary: 'İki ekonomi birlikte büyür, ucuz ithalat yerli üreticiyi kızdırır. Aynı anda en fazla 2 anlaşma.',
    hint: 'Bilateral trade deal: both economies benefit for a while; domestic producers grumble.',
    category: 'foreign',
    target: 'country',
    actors: ['player', 'foreign'],
    cost: 1,
    durationTurns: 5,
    unique: true,
    rules: [...BILATERAL, { kind: 'max_active', count: 2 }],
    modifiers: [perTurn('economy', 1, 'actor'), once('approval', -1, 'actor'), perTurn('economy', 1)],
    tags: ['ticaret', 'diplomasi']
  },
  sanctions: {
    id: 'sanctions',
    label: 'Yaptırım',
    summary: 'Hedef ülkeyi sarsar, içeride milliyetçi destek getirir. Kendi ekonomin de zarar görür; karşılık gelebilir.',
    hint: 'Economic sanctions against another country: hurts the target more than the sender, invites retaliation.',
    category: 'foreign',
    target: 'country',
    actors: ['player', 'foreign'],
    cost: 1,
    durationTurns: 5,
    unique: true,
    rules: [...BILATERAL, { kind: 'max_active', count: 2 }],
    modifiers: [perTurn('economy', -2), once('reputation', -1), perTurn('economy', -1, 'actor'), once('approval', 2, 'actor')],
    tags: ['yaptirim', 'diplomasi']
  },
  diplomatic_protest: {
    id: 'diplomatic_protest',
    label: 'Diplomatik nota',
    summary: 'Resmî itiraz. Sembolik; sana puan kazandırmaz, karşı tarafın itibarını biraz zedeler. Bedava.',
    hint: 'A formal protest note: symbolic, small reputational cost for the target.',
    category: 'foreign',
    target: 'country',
    actors: ['player', 'foreign'],
    cost: 0,
    durationTurns: 1,
    unique: true,
    rules: BILATERAL,
    modifiers: [once('reputation', -1)],
    tags: ['diplomasi']
  },
  military_aid: {
    id: 'military_aid',
    label: 'Askerî yardım',
    summary: 'Başka bir ülkeye silah ve eğitim. Kendi gücünden verirsin; dostluk ileride karşılık bulabilir.',
    hint: 'Weapons and training sent to another country; may be repaid with friendship later.',
    category: 'military',
    target: 'country',
    actors: ['player', 'foreign'],
    cost: 1,
    durationTurns: 1,
    unique: true,
    rules: BILATERAL,
    modifiers: [once('military', 3), once('military', -2, 'actor'), once('reputation', 1, 'actor')],
    tags: ['askeri', 'diplomasi']
  },
  military_buildup: {
    id: 'military_buildup',
    label: 'Askerî yığınak',
    summary: 'Ordu güçlenir, içeride güven artar. Pahalıdır; komşular bundan tedirgin olur.',
    hint: 'Mobilisation and procurement: stronger armed forces, costly, worries neighbours.',
    category: 'military',
    target: 'country',
    actors: ['player', 'foreign'],
    cost: 1,
    durationTurns: 4,
    unique: true,
    rules: DOMESTIC,
    modifiers: [perTurn('military', 2), perTurn('economy', -1), once('stability', 2), once('reputation', -2)],
    tags: ['askeri']
  },

  energy_cutoff: {
    id: 'energy_cutoff',
    label: 'Enerji kesintisi',
    summary: 'Tedarikçi ülke gaz veya petrol akışını kesiyor.',
    hint: 'A supplier country cuts gas or oil deliveries to the target.',
    category: 'foreign',
    target: 'country',
    actors: ['foreign'],
    cost: 0,
    durationTurns: 4,
    unique: true,
    rules: BILATERAL,
    modifiers: [perTurn('economy', -2), perTurn('welfare', -1), once('stability', -2)],
    tags: ['enerji', 'ekonomi']
  },
  foreign_investment: {
    id: 'foreign_investment',
    label: 'Yabancı yatırım dalgası',
    summary: 'Başka bir ülkenin şirketleri yatırım yapıyor.',
    hint: 'Companies from the acting country pour investment into the target.',
    category: 'foreign',
    target: 'country',
    actors: ['foreign'],
    cost: 0,
    durationTurns: 4,
    unique: true,
    rules: BILATERAL,
    modifiers: [perTurn('economy', 1), once('approval', 1)],
    tags: ['ekonomi', 'yatirim']
  },
  eu_process_frozen: {
    id: 'eu_process_frozen',
    label: 'AB süreci donduruldu',
    summary: 'Bir AB başkenti üyelik sürecini veto tehdidiyle durdurdu.',
    hint: 'An EU capital blocks the target’s accession process for a while.',
    category: 'foreign',
    target: 'country',
    actors: ['foreign'],
    cost: 0,
    durationTurns: 6,
    unique: true,
    rules: BILATERAL,
    modifiers: [once('reputation', -3), once('approval', -3)],
    tags: ['ab', 'diplomasi']
  },
  eu_funds: {
    id: 'eu_funds',
    label: 'AB fonları',
    summary: 'Üyelikle gelen uyum fonları akmaya başladı.',
    hint: 'EU structural funds start flowing to a new member.',
    category: 'foreign',
    target: 'country',
    actors: ['foreign'],
    cost: 0,
    durationTurns: 5,
    unique: true,
    rules: BILATERAL,
    modifiers: [perTurn('economy', 1), perTurn('welfare', 1)],
    tags: ['ab', 'ekonomi']
  },
  protest_wave: {
    id: 'protest_wave',
    label: 'Protesto dalgası',
    summary: 'Biriken öfke sokaklara taşıyor.',
    hint: 'Mass street protests erupt against the government.',
    category: 'world',
    target: 'country',
    actors: ['world'],
    cost: 0,
    durationTurns: 2,
    unique: false,
    rules: [],
    modifiers: [once('stability', -7), once('approval', -4), perTurn('economy', -1)],
    tags: ['ic-siyaset', 'protesto']
  },
  inflation_spike: {
    id: 'inflation_spike',
    label: 'Enflasyon sıçraması',
    summary: 'Fiyatlar hızla yükseliyor, maaşlar eriyor.',
    hint: 'Prices surge and wages lose value.',
    category: 'world',
    target: 'country',
    actors: ['world'],
    cost: 0,
    durationTurns: 3,
    unique: false,
    rules: [],
    modifiers: [perTurn('economy', -1), perTurn('welfare', -2), once('approval', -3)],
    tags: ['ekonomi', 'enflasyon']
  },
  budget_gap: {
    id: 'budget_gap',
    label: 'Bütçe açığı',
    summary: 'Kasada delik açıldı, harcamalar kısılıyor.',
    hint: 'A widening budget deficit forces cuts.',
    category: 'world',
    target: 'country',
    actors: ['world'],
    cost: 0,
    durationTurns: 3,
    unique: false,
    rules: [],
    modifiers: [perTurn('economy', -2), once('welfare', -1), once('approval', -1)],
    tags: ['ekonomi', 'butce']
  },
  elite_backlash: {
    id: 'elite_backlash',
    label: 'Eski düzenin tepkisi',
    summary: 'Koltuğunu kaybedenler karşı hamleye geçiyor.',
    hint: 'Displaced power brokers strike back through courts, media and business.',
    category: 'world',
    target: 'country',
    actors: ['world'],
    cost: 0,
    durationTurns: 1,
    unique: false,
    rules: [],
    modifiers: [once('stability', -4), once('approval', -2)],
    tags: ['ic-siyaset']
  },
  nationalist_backlash: {
    id: 'nationalist_backlash',
    label: 'Milliyetçi tepki',
    summary: 'Egemenlik kaybına öfkelenen kesimler ayağa kalkıyor.',
    hint: 'Nationalists rally against lost sovereignty.',
    category: 'world',
    target: 'country',
    actors: ['world'],
    cost: 0,
    durationTurns: 1,
    unique: false,
    rules: [],
    modifiers: [once('approval', -4), once('stability', -2)],
    tags: ['ic-siyaset', 'milliyetcilik']
  },
  investor_confidence: {
    id: 'investor_confidence',
    label: 'Yatırımcı güveni',
    summary: 'Piyasalar disiplini ödüllendiriyor, sermaye geri dönüyor.',
    hint: 'Markets reward fiscal discipline; capital flows back in.',
    category: 'world',
    target: 'country',
    actors: ['world'],
    cost: 0,
    durationTurns: 3,
    unique: true,
    rules: [],
    modifiers: [perTurn('economy', 2), once('approval', 2)],
    tags: ['ekonomi', 'yatirim']
  },
  regional_boom: {
    id: 'regional_boom',
    label: 'Bölgesel kalkınma',
    summary: 'Yatırım yapılan bölge meyvesini veriyor.',
    hint: 'An invested region takes off, lifting living standards.',
    category: 'world',
    target: 'country',
    actors: ['world'],
    cost: 0,
    durationTurns: 3,
    unique: true,
    rules: [],
    modifiers: [perTurn('welfare', 1), once('approval', 2)],
    tags: ['ekonomi', 'bolgesel']
  },
  regional_tension: {
    id: 'regional_tension',
    label: 'Bölgesel gerginlik',
    summary: 'Komşular silahlanıyor, sınırda gerilim tırmanıyor.',
    hint: 'Neighbours arm up in response; tension rises on the border.',
    category: 'world',
    target: 'country',
    actors: ['world'],
    cost: 0,
    durationTurns: 2,
    unique: false,
    rules: [],
    modifiers: [once('stability', -3), perTurn('economy', -1), once('reputation', -2)],
    tags: ['askeri', 'gerginlik']
  }
}

/** Effects the player's government can choose, in catalog order. */
export const PLAYER_EFFECT_IDS = EFFECT_IDS.filter((id) => EFFECTS[id].actors.includes('player'))

/** Compact catalog for the LLM's (cached) system prompt: ids and words only, never numbers. */
export function catalogForPrompt(): Array<Pick<EffectDef, 'id' | 'hint' | 'target' | 'actors'>> {
  return EFFECT_IDS.map((id) => {
    const { hint, target, actors } = EFFECTS[id]
    return { id, hint, target, actors }
  })
}
