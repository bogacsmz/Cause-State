import { EFFECTS, type EffectId } from '@shared/game/catalog'
import type { ChangeList, ForeignIntent, SeedOutcome, SeedPlan, SeedProposal } from '@shared/game/contract'
import { countryRef, entityKey, type EntityRef } from '@shared/game/primitives'
import type { GameState, Seed } from '@shared/game/schema'
import { mentionedEntities } from './context'
import { entityName, findCountry, owningCountry } from './lookup'
import { checkDecision, explainIssue } from './referee'
import { hashRoll } from './rng'

// Phase 1's stand-in for the LLM. It speaks the exact same contract (a ChangeList the
// referee must approve), but with scripted rules instead of a model. Phase 2 replaces
// this file with a real Claude call; nothing else in the pipeline changes.

export interface Decision {
  effectId: EffectId
  target: EntityRef
}

export type Interpretation =
  | { kind: 'decision'; decision: Decision; reply: string }
  | { kind: 'talk'; reply: string }

// ── seeds: what each decision may bring back later ─────────────────────────

interface SeedScript {
  key: string
  dormancy: SeedProposal['dormancy']
  likelihood: SeedProposal['likelihood']
  /** Who acts when it fires: society/the world, the decision's target country, or a named country. */
  actor: 'world' | 'target' | string
  outcome: EffectId
  hook: (ctx: { turn: number; target: string }) => string
  headline: string
  body: (ctx: { planted: number; target: string }) => string
}

const SEED_SCRIPTS: Partial<Record<EffectId, readonly SeedScript[]>> = {
  tax_cut: [
    {
      key: 'butce-acigi',
      dormancy: 'medium',
      likelihood: 'likely',
      actor: 'world',
      outcome: 'budget_gap',
      hook: ({ turn }) => `Tur ${turn}: vergi indirimi kasada delik açıyor. Bütçe bir gün bunun hesabını soracak.`,
      headline: 'Hazinede alarm: bütçe açığı büyüdü',
      body: ({ planted }) => `Tur ${planted}'deki vergi indiriminin faturası geldi. Hazine harcamaları kısmak zorunda kaldı.`
    }
  ],
  fiscal_stimulus: [
    {
      key: 'enflasyon',
      dormancy: 'medium',
      likelihood: 'likely',
      actor: 'world',
      outcome: 'inflation_spike',
      hook: ({ turn }) => `Tur ${turn}: teşvik paketiyle piyasaya para pompalandı. Fiyatlar er geç tepki verecek.`,
      headline: 'Fiyatlar uçtu: enflasyon sıçradı',
      body: ({ planted }) => `Tur ${planted}'de piyasaya pompalanan para mutfağa ulaştı. Market fiyatları haftalar içinde tırmandı.`
    }
  ],
  austerity: [
    {
      key: 'kemer-meyvesi',
      dormancy: 'long',
      likelihood: 'possible',
      actor: 'world',
      outcome: 'investor_confidence',
      hook: ({ turn }) => `Tur ${turn}: kemer sıkma piyasalara disiplin mesajı verdi. Yatırımcılar bunu hatırlayabilir.`,
      headline: 'Piyasalar disiplini ödüllendirdi',
      body: ({ planted }) => `Tur ${planted}'de başlayan kemer sıkma meyvesini verdi. Yabancı sermaye yeniden ülkeye yöneldi.`
    }
  ],
  regional_investment: [
    {
      key: 'bolgesel-kalkinma',
      dormancy: 'medium',
      likelihood: 'likely',
      actor: 'world',
      outcome: 'regional_boom',
      hook: ({ turn, target }) => `Tur ${turn}: ${target} için başlatılan yatırım bölgede umut yarattı.`,
      headline: 'Bölgesel yatırım meyvesini verdi',
      body: ({ planted, target }) => `Tur ${planted}'de ${target} için başlatılan projeler tamamlandı. Yeni işler ve yollar bölgeyi canlandırdı.`
    }
  ],
  anti_corruption_drive: [
    {
      key: 'eski-duzen',
      dormancy: 'short',
      likelihood: 'possible',
      actor: 'world',
      outcome: 'elite_backlash',
      hook: ({ turn }) => `Tur ${turn}: yolsuzluk operasyonunda koltuk kaybedenler intikam için fırsat kolluyor.`,
      headline: 'Eski düzen karşı hamleye geçti',
      body: ({ planted }) => `Tur ${planted}'deki operasyonda tasfiye edilenler medyada ve mahkemelerde hükümete karşı cephe açtı.`
    }
  ],
  press_crackdown: [
    {
      key: 'baski-birikimi',
      dormancy: 'medium',
      likelihood: 'likely',
      actor: 'world',
      outcome: 'protest_wave',
      hook: ({ turn }) => `Tur ${turn}: basına uygulanan baskı sessiz bir öfke biriktiriyor. Bir gün sokaklara taşabilir.`,
      headline: 'Susturulan öfke sokaklara taştı',
      body: ({ planted }) => `Tur ${planted}'de basına uyguladığın baskı unutulmadı. Biriken öfke bugün büyük meydanlarda patladı.`
    }
  ],
  eu_accession_bid: [
    {
      key: 'fransa-vetosu',
      dormancy: 'medium',
      likelihood: 'possible',
      actor: 'FRA',
      outcome: 'eu_process_frozen',
      hook: ({ turn }) => `Tur ${turn}: AB başvurusu Paris'te soğuk karşılandı. Fransa süreci bir zirvede durdurmaya çalışabilir.`,
      headline: 'Paris vetoyu çekti: AB süreci donduruldu',
      body: ({ planted }) => `Tur ${planted}'deki AB başvurusu Brüksel zirvesinde Fransa'nın veto tehdidine takıldı. Süreç en az altı ay donduruldu.`
    }
  ],
  eu_membership: [
    {
      key: 'milliyetci-tepki',
      dormancy: 'short',
      likelihood: 'likely',
      actor: 'world',
      outcome: 'nationalist_backlash',
      hook: ({ turn }) => `Tur ${turn}: AB üyeliğiyle egemenlik kaybına öfkelenen kesimler örgütleniyor.`,
      headline: 'Egemenlik mitingleri: milliyetçi tepki büyüdü',
      body: ({ planted }) => `Tur ${planted}'deki AB üyeliği sonrası "egemenlik elden gidiyor" diyenler meydanları doldurdu.`
    },
    {
      key: 'ab-fonlari',
      dormancy: 'medium',
      likelihood: 'likely',
      actor: 'DEU',
      outcome: 'eu_funds',
      hook: ({ turn }) => `Tur ${turn}: AB üyeliğiyle birlikte uyum fonlarının yolu açıldı.`,
      headline: 'AB fonları akmaya başladı',
      body: ({ planted }) => `Tur ${planted}'deki üyeliğin ilk somut meyvesi: Berlin'in öncülüğünde uyum fonları serbest bırakıldı.`
    }
  ],
  trade_agreement: [
    {
      key: 'ticaret-meyvesi',
      dormancy: 'medium',
      likelihood: 'likely',
      actor: 'target',
      outcome: 'foreign_investment',
      hook: ({ turn, target }) => `Tur ${turn}: ${target} ile ticaret anlaşması imzalandı. Karşı tarafın şirketleri fırsat kolluyor.`,
      headline: 'Ticaret anlaşması yatırım getirdi',
      body: ({ planted, target }) => `Tur ${planted}'de ${target} ile imzalanan anlaşma meyvesini verdi. Şirketleri yeni fabrikalar için harekete geçti.`
    }
  ],
  sanctions: [
    {
      key: 'karsi-yaptirim',
      dormancy: 'short',
      likelihood: 'likely',
      actor: 'target',
      outcome: 'sanctions',
      hook: ({ turn, target }) => `Tur ${turn}: ${target}'a yaptırım uygulandı. Karşılık vermek için zamanını bekliyor.`,
      headline: 'Karşı yaptırım geldi',
      body: ({ planted, target }) => `Tur ${planted}'de ${target}'a uyguladığın yaptırıma aynı sertlikte karşılık verildi.`
    }
  ],
  military_aid: [
    {
      key: 'minnet',
      dormancy: 'long',
      likelihood: 'possible',
      actor: 'target',
      outcome: 'trade_agreement',
      hook: ({ turn, target }) => `Tur ${turn}: ${target}'a askerî yardım gönderildi. Bu iyilik unutulmayabilir.`,
      headline: 'Eski dost vefasını gösterdi',
      body: ({ planted, target }) => `Tur ${planted}'de gönderdiğin askerî yardımı unutmayan ${target}, sana ayrıcalıklı bir ticaret anlaşması önerdi.`
    }
  ],
  military_buildup: [
    {
      key: 'ege-gerginligi',
      dormancy: 'short',
      likelihood: 'likely',
      actor: 'world',
      outcome: 'regional_tension',
      hook: ({ turn }) => `Tur ${turn}: askerî yığınak komşuları tedirgin etti. Bölgede silahlanma yarışı başlayabilir.`,
      headline: "Ege'de gerilim tırmandı",
      body: ({ planted }) => `Tur ${planted}'deki askerî yığınağa komşular kendi hazırlıklarıyla karşılık verdi. Sınırda gerilim yükseldi.`
    }
  ]
}

/**
 * The world moves on its own too. Now and then the AI notices a storm gathering abroad:
 * it shows up in the news first (the foreshadowing), and the code decides if and when it hits.
 */
interface WorldScript extends SeedScript {
  /** The line in this turn's news that hints at it. */
  foreshadow: string
}

/** Chance per turn that a new world development starts brewing. */
export const WORLD_EVENT_CHANCE = 0.3

const WORLD_SCRIPTS: readonly WorldScript[] = [
  {
    key: 'rus-gazi',
    dormancy: 'medium',
    likelihood: 'possible',
    actor: 'RUS',
    outcome: 'energy_cutoff',
    foreshadow: 'Dünya gündemi: Moskova doğalgaz fiyatları için yeni pazarlık istiyor, sert sinyaller veriyor.',
    hook: () => 'Rusya doğalgaz anlaşmasını yeniden masaya yatırmak istiyor; vanayı kısmakla tehdit ediyor.',
    headline: 'Moskova vanayı kıstı',
    body: ({ planted }) => `Tur ${planted}'de gelen sinyaller doğru çıktı: Rusya doğalgaz akışını kıstı. Fabrikalar ve evler zor günlere hazırlanıyor.`
  },
  {
    key: 'emtia',
    dormancy: 'medium',
    likelihood: 'possible',
    actor: 'world',
    outcome: 'inflation_spike',
    foreshadow: 'Dünya gündemi: küresel emtia fiyatları tırmanıyor, ithalat faturası kabarıyor.',
    hook: () => 'Küresel emtia fiyatları tırmanıyor; ithalat faturası er geç rafları vuracak.',
    headline: 'İthal enflasyon kapıda',
    body: ({ planted }) => `Tur ${planted}'de başlayan küresel fiyat artışı sonunda raflara yansıdı. Market fişleri kabardı.`
  },
  {
    key: 'turizm',
    dormancy: 'medium',
    likelihood: 'possible',
    actor: 'DEU',
    outcome: 'foreign_investment',
    foreshadow: "Dünya gündemi: Alman turizm şirketleri Ege kıyılarında yatırım fırsatı arıyor.",
    hook: () => "Alman turizm şirketleri Ege'de yatırım fırsatı kolluyor.",
    headline: "Alman sermayesi Ege'de",
    body: ({ planted }) => `Tur ${planted}'de konuşulan turizm yatırımları gerçek oldu. Alman şirketleri yeni oteller için imzayı attı.`
  },
  {
    key: 'sinir-otesi',
    dormancy: 'short',
    likelihood: 'possible',
    actor: 'world',
    outcome: 'regional_tension',
    foreshadow: 'Dünya gündemi: sınır ötesinde çatışmalar tırmanıyor, göç dalgası endişesi büyüyor.',
    hook: () => 'Sınır ötesinde çatışmalar tırmanıyor; kıvılcım sınırın bu yanına sıçrayabilir.',
    headline: 'Sınırda tansiyon yükseldi',
    body: ({ planted }) => `Tur ${planted}'den beri süren sınır ötesi çatışmalar sonunda bu yakaya taştı. Güvenlik alarmı verildi.`
  },
  {
    key: 'abd-ticaret',
    dormancy: 'medium',
    likelihood: 'possible',
    actor: 'USA',
    outcome: 'trade_agreement',
    foreshadow: 'Dünya gündemi: Washington bölgede yeni ticaret ortakları arıyor.',
    hook: () => 'Washington bölgede yeni ticaret ortakları arıyor; Ankara listede.',
    headline: 'Washington kapıyı açtı',
    body: ({ planted }) => `Tur ${planted}'de konuşulmaya başlanan ticaret çerçevesi imzalandı. ABD pazarı Türk ürünlerine açılıyor.`
  }
]

const SCRIPTS_BY_KEY = new Map(
  [...Object.values(SEED_SCRIPTS).flat(), ...WORLD_SCRIPTS].map((s) => [s.key, s] as const)
)

/** Immediate reactions from other countries to a decision. */
const REACTIONS: Partial<Record<EffectId, (d: Decision) => { actor: string; reason: string } | null>> = {
  military_buildup: () => ({ actor: 'GRC', reason: 'Atina, sınır yakınındaki yığınağı "kışkırtıcı" buldu.' }),
  press_crackdown: () => ({ actor: 'DEU', reason: 'Berlin, basın özgürlüğüne yönelik adımları kınadı.' }),
  sanctions: (d) => ({ actor: d.target.id, reason: 'Yaptırıma uğrayan ülke tepkisini resmî notayla bildirdi.' })
}

const HEADLINES: Partial<Record<EffectId, string>> = {
  tax_cut: 'Vergiler indirildi',
  fiscal_stimulus: 'Dev teşvik paketi açıklandı',
  austerity: 'Kemer sıkma dönemi başladı',
  regional_investment: 'Bölgesel yatırım hamlesi',
  anti_corruption_drive: 'Yolsuzluğa büyük operasyon',
  press_crackdown: 'Basına yeni kısıtlamalar',
  eu_accession_bid: "Ankara Brüksel'in kapısını çaldı",
  eu_membership: 'Türkiye artık AB üyesi',
  trade_agreement: 'Yeni ticaret anlaşması imzalandı',
  sanctions: 'Yaptırım kararı alındı',
  diplomatic_protest: 'Diplomatik nota verildi',
  military_aid: 'Askerî yardım yola çıktı',
  military_buildup: 'Orduya büyük takviye'
}

// ── order interpretation ────────────────────────────────────────────────────

/** Keyword groups: every group must match (at least one word from each). Checked in order. */
const ORDER_PATTERNS: ReadonlyArray<{ effectId: EffectId; groups: readonly (readonly string[])[] }> = [
  { effectId: 'military_aid', groups: [['askeri yardım', 'askerî yardım', 'silah gönder', 'silah yardımı', 'silah yolla']] },
  { effectId: 'eu_membership', groups: [['ab', 'avrupa birliği'], ['üye ol', 'üyeliğ', 'katıl', 'gir']] },
  { effectId: 'eu_accession_bid', groups: [['ab', 'avrupa birliği'], ['başvur', 'aday']] },
  { effectId: 'trade_agreement', groups: [['ticaret', 'ticari', 'serbest ticaret'], ['anlaş', 'antlaş', 'imzala', 'artır']] },
  { effectId: 'sanctions', groups: [['yaptırım', 'ambargo']] },
  { effectId: 'diplomatic_protest', groups: [['nota', 'kına', 'protesto et', 'büyükelçiyi çağır']] },
  { effectId: 'tax_cut', groups: [['vergi'], ['indir', 'düşür', 'azalt', 'kes']] },
  { effectId: 'austerity', groups: [['kemer sık', 'tasarruf', 'harcamaları kıs', 'harcamaları azalt', 'bütçe disiplin']] },
  { effectId: 'fiscal_stimulus', groups: [['teşvik', 'para bas', 'kamu harcama', 'ekonomiyi canlandır', 'harcamaları artır']] },
  { effectId: 'regional_investment', groups: [['yatırım', 'altyapı', 'fabrika', 'yol yap', 'kalkınma']] },
  { effectId: 'anti_corruption_drive', groups: [['yolsuzluk', 'rüşvet', 'temizlik operasyonu']] },
  { effectId: 'press_crackdown', groups: [['basın', 'gazete', 'sansür', 'medya'], ['sus', 'kapat', 'yasak', 'baskı', 'kısıtla', 'sansür', 'engelle']] },
  { effectId: 'military_buildup', groups: [['ordu', 'silahlan', 'yığınak', 'seferber', 'savunma bütçe', 'asker']] }
]

/** Turns a typed order into one catalog decision, or into free advice. Never spends capital itself. */
export function interpretOrder(state: GameState, text: string): Interpretation {
  const haystack = ` ${text.toLocaleLowerCase('tr')} `
  const match = ORDER_PATTERNS.find((p) => p.groups.every((group) => group.some((w) => containsWord(haystack, w))))
  if (!match) return { kind: 'talk', reply: adviceFor(state, haystack) }

  const def = EFFECTS[match.effectId]
  const player = state.playerCountryId
  const mentioned = mentionedEntities(state, text)
  let target: EntityRef | undefined
  if (def.target === 'province') {
    target = mentioned.find((r) => r.type === 'province' && owningCountry(state, r) === player)
    if (!target) {
      return { kind: 'talk', reply: `${def.label} için bir il söyle. Örnek: "İzmir'e bölgesel yatırım yap".` }
    }
  } else if (def.rules.some((r) => r.kind === 'target_not_actor')) {
    target = mentioned.find((r) => r.type === 'country' && r.id !== player)
    if (!target) {
      return { kind: 'talk', reply: `${def.label} için bir ülke söyle. Örnek: "Yunanistan ile ${def.label.toLocaleLowerCase('tr')} yap".` }
    }
  } else {
    target = countryRef(player)
  }

  const issues = checkDecision(state, match.effectId, target)
  if (issues.length > 0) {
    return { kind: 'talk', reply: `Emrini "${def.label}" olarak anladım ama şu an olmaz: ${explainIssue(issues[0]!)}` }
  }
  const where = target.id === player ? '' : ` (${entityName(state, target)})`
  const price = def.cost === 0 ? 'bedava' : `${def.cost} siyasi sermaye`
  return {
    kind: 'decision',
    decision: { effectId: match.effectId, target },
    reply: `Anlaşıldı: ${def.label}${where}. Bu tur kararlarına eklendi, bedeli ${price}.`
  }
}

function adviceFor(state: GameState, haystack: string): string {
  const me = findCountry(state, state.playerCountryId)
  if (!me) return 'Emrinizi anlayamadım.'
  const turnsLeft = Math.max(0, state.election.nextTurn - state.turn)
  const status = `Anketler %${me.bars.approval} gösteriyor. Seçime ${turnsLeft} ay kaldı, baraj %${state.election.threshold}.`
  const weakest = (['economy', 'welfare', 'stability'] as const).reduce((a, b) => (me.bars[a] <= me.bars[b] ? a : b))
  const hint = {
    economy: 'En zayıf halkamız ekonomi. Teşvik ya da ticaret anlaşması düşünebilirsiniz, ama bedelleri var.',
    welfare: 'Halkın cebi zayıf. Refah artmadan onay kalıcı olarak yükselmez.',
    stability: 'İstikrar zayıflıyor. Kışlalardaki sesleri hafife almayın.'
  }[weakest]
  const asking = /\?|durum|rapor|öneri|ne yap|tavsiye|anket|nasıl/.test(haystack)
  if (asking) return `${status} ${hint}`
  return (
    'Bu emri elimizdeki kararlardan birine çeviremedim. Örnekler: "vergileri indir", "Yunanistan ile ticaret anlaşması yap", ' +
    `"AB'ye başvur", "İzmir'e yatırım yap". ${status}`
  )
}

function containsWord(haystack: string, word: string): boolean {
  // Word start required; Turkish suffixes after it are fine ("AB'ye", "vergileri").
  let from = 0
  for (;;) {
    const at = haystack.indexOf(word, from)
    if (at === -1) return false
    const before = haystack[at - 1] ?? ' '
    if (!/\p{L}/u.test(before)) {
      // Very short words must also end at a word boundary or apostrophe ("ab" but not "abartı").
      const after = haystack[at + word.length] ?? ' '
      if (word.length > 2 || !/\p{L}/u.test(after)) return true
    }
    from = at + 1
  }
}

// ── the turn's ChangeList ───────────────────────────────────────────────────

export interface ScriptInput {
  decisions: readonly Decision[]
  orders: readonly string[]
  plan: SeedPlan
}

/** Builds the scripted AI's proposal for a turn. It still has to pass the referee. */
export function scriptedChangeList(state: GameState, input: ScriptInput): ChangeList {
  const player = state.playerCountryId
  const turn = state.turn + 1
  const playerRef = countryRef(player)
  const name = (ref: EntityRef): string => entityName(state, ref)

  const changes = input.decisions.map((d) => ({
    effectId: d.effectId,
    target: d.target,
    reason: `${EFFECTS[d.effectId].label} kararı${d.target.id === player ? '' : ` (${name(d.target)})`}.`
  }))

  const foreignIntents: ForeignIntent[] = []
  const reactionLines: string[] = []
  for (const d of input.decisions) {
    const reaction = REACTIONS[d.effectId]?.(d)
    if (!reaction || reaction.actor === player || foreignIntents.some((f) => f.actor === reaction.actor)) continue
    const intent: ForeignIntent = { actor: reaction.actor, effectId: 'diplomatic_protest', target: playerRef, reason: reaction.reason }
    const alreadyProtesting = state.effects.some((e) => e.effectId === 'diplomatic_protest' && e.actor === reaction.actor)
    if (alreadyProtesting) continue
    foreignIntents.push(intent)
    reactionLines.push(reaction.reason)
  }

  const newSeeds: SeedProposal[] = []
  // The world first: a development abroad that may hit later.
  const worldLines: string[] = []
  if (hashRoll(`${state.gameId}|world|${turn}`) < WORLD_EVENT_CHANCE) {
    const script = WORLD_SCRIPTS[Math.floor(hashRoll(`${state.gameId}|world-pick|${turn}`) * WORLD_SCRIPTS.length)]!
    const actorRef = script.actor === 'world' ? null : countryRef(script.actor)
    newSeeds.push({
      source: null,
      hook: script.hook({ turn, target: name(playerRef) }),
      entities: uniqueRefs([playerRef, ...(actorRef ? [actorRef] : [])]),
      tags: [script.key, ...EFFECTS[script.outcome].tags.slice(0, 2)],
      dormancy: script.dormancy,
      likelihood: script.likelihood,
      condition: null
    })
    worldLines.push(script.foreshadow)
  }
  for (const d of input.decisions) {
    for (const script of SEED_SCRIPTS[d.effectId] ?? []) {
      if (newSeeds.length >= 3) break
      const actorRef = script.actor === 'world' ? null : countryRef(script.actor === 'target' ? d.target.id : script.actor)
      const entities = uniqueRefs([playerRef, ...(d.target.id !== player ? [d.target] : []), ...(actorRef ? [actorRef] : [])])
      newSeeds.push({
        source: d.effectId,
        hook: script.hook({ turn, target: name(d.target) }),
        entities,
        tags: [script.key, ...EFFECTS[script.outcome].tags.slice(0, 2)],
        dormancy: script.dormancy,
        likelihood: script.likelihood,
        condition: null
      })
    }
  }

  const seedOutcomes: SeedOutcome[] = []
  const seedLines: string[] = []
  const seedHeadlines: string[] = []
  const used = new Set<string>()
  for (const seed of input.plan.firing) {
    const { outcome, line, headline } = resolveSeed(state, seed, used)
    seedOutcomes.push(outcome)
    seedLines.push(line)
    if (headline) seedHeadlines.push(headline)
  }

  const turnsLeft = state.election.nextTurn - turn
  const decisionLabels = input.decisions.map((d) => EFFECTS[d.effectId].label.toLocaleLowerCase('tr'))
  const body = [
    ...seedLines,
    decisionLabels.length > 0
      ? `Hükümet bu ay şu adımları attı: ${decisionLabels.join(', ')}.`
      : 'Ankara bu ay yeni bir adım atmadı; gözler anketlerde.',
    ...reactionLines,
    ...worldLines,
    turnsLeft > 0 && turnsLeft <= 3 ? `Seçime ${turnsLeft} ay kaldı.` : ''
  ]
    .filter(Boolean)
    .join(' ')

  const firstDecision = input.decisions[0]
  const headline =
    seedHeadlines[0] ?? (firstDecision ? HEADLINES[firstDecision.effectId] : undefined) ?? 'Sessiz bir ay'

  return {
    interpretation:
      input.orders.length > 0
        ? `Emirler: ${input.orders.join(' / ')}`.slice(0, 400)
        : decisionLabels.length > 0
          ? `Kararlar: ${decisionLabels.join(', ')}`
          : 'Bu tur yeni karar yok.',
    changes,
    foreignIntents,
    newSeeds,
    seedOutcomes,
    narration: { headline: headline.slice(0, 120), body: body.slice(0, 1500) }
  }
}

function resolveSeed(
  state: GameState,
  seed: Seed,
  used: Set<string>
): { outcome: SeedOutcome; line: string; headline?: string } {
  const player = state.playerCountryId
  const script = SCRIPTS_BY_KEY.get(seed.tags[0] ?? '')
  const storyOnly = (reason: string): { outcome: SeedOutcome; line: string } => ({
    outcome: { seedId: seed.id, actor: null, effectId: null, target: null, reason },
    line: reason
  })
  if (!script) return storyOnly(`Geçmişten bir yankı: ${seed.hook}`)

  const target = countryRef(player)
  const actorId =
    script.actor === 'world'
      ? null
      : script.actor === 'target'
        ? (seed.entities.find((r) => r.type === 'country' && r.id !== player)?.id ?? null)
        : script.actor
  const targetName = actorId ? (findCountry(state, actorId)?.name ?? actorId) : entityName(state, target)
  const body = script.body({ planted: seed.plantedTurn, target: targetName })

  const effectActor = actorId ?? player
  // Consequences stack; only a unique effect that is already running folds into the story.
  const busy =
    EFFECTS[script.outcome].unique &&
    (used.has(`${script.outcome}|${effectActor}`) ||
      state.effects.some((e) => e.effectId === script.outcome && e.actor === effectActor && entityKey(e.target) === entityKey(target)))
  if (busy || (script.actor !== 'world' && actorId === null)) {
    return storyOnly(`${body} Etkisi zaten sürenlerle birleşti.`)
  }
  used.add(`${script.outcome}|${effectActor}`)
  return {
    outcome: { seedId: seed.id, actor: actorId, effectId: script.outcome, target, reason: body },
    line: body,
    headline: script.headline
  }
}

function uniqueRefs(refs: readonly EntityRef[]): EntityRef[] {
  return refs.filter((r, i) => refs.findIndex((o) => entityKey(o) === entityKey(r)) === i)
}
