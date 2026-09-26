import type { ChangeList, SeedPlan } from '../../src/shared/game/contract'

export const NO_SEEDS: SeedPlan = { firing: [], fizzled: [] }

// A hand-written ChangeList: what the LLM should return for this order.
export const ORDER = "AB'ye üyelik başvurusu yap ve Yunanistan'la ticaret anlaşması imzala."

export const VALID_CHANGES: ChangeList = {
  interpretation: 'Türkiye AB üyeliğine resmen başvuruyor ve Yunanistan ile ikili ticaret anlaşması imzalıyor.',
  changes: [
    { effectId: 'eu_accession_bid', target: { type: 'country', id: 'TUR' }, reason: 'Resmî AB üyelik başvurusu.' },
    { effectId: 'trade_agreement', target: { type: 'country', id: 'GRC' }, reason: 'Ege ticaretini canlandıracak ikili anlaşma.' }
  ],
  foreignIntents: [
    {
      actor: 'FRA',
      effectId: 'diplomatic_protest',
      target: { type: 'country', id: 'TUR' },
      reason: 'Paris, başvurunun zamanlamasını erken buluyor ve itirazını resmî notayla bildiriyor.'
    }
  ],
  newSeeds: [
    {
      source: 'eu_accession_bid',
      hook: "Fransa, Türkiye'nin AB sürecini ilerideki bir zirvede veto tehdidiyle durdurmaya çalışabilir.",
      entities: [
        { type: 'country', id: 'FRA' },
        { type: 'country', id: 'TUR' }
      ],
      tags: ['AB', 'Veto Tehdidi'],
      dormancy: 'medium',
      likelihood: 'possible',
      condition: null
    }
  ],
  seedOutcomes: [],
  narration: {
    headline: "Ankara Brüksel'in kapısını çaldı",
    body: 'Türkiye AB üyeliği için resmî başvurusunu yaptı. Aynı gün Yunanistan ile imzalanan ticaret anlaşması Ege limanlarında umutla karşılandı. Paris ise itirazını gizlemedi.'
  }
}

/** Deep copy with a modification, for building invalid variants. */
export function variant(mutate: (c: Record<string, unknown> & ChangeList) => void): unknown {
  const copy = structuredClone(VALID_CHANGES) as Record<string, unknown> & ChangeList
  mutate(copy)
  return copy
}
