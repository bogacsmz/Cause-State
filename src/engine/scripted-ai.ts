import { EFFECTS, type EffectId } from '@shared/game/catalog'
import { LIMITS, type ChangeList, type Development, type ForeignIntent, type SeedOutcome, type SeedPlan, type SeedProposal } from '@shared/game/contract'
import { consequenceFits, type Beat, type ConsequenceTone, type Impact, type Lasts, type Tone } from '@shared/game/impacts'
import { countryRef, entityKey, type Bars, type EntityRef } from '@shared/game/primitives'
import type { GameState, Seed } from '@shared/game/schema'
import { mentionedEntities } from './context'
import { entityName, findCountry, owningCountry } from './lookup'
import { checkDecision, explainIssue } from './referee'
import { ek } from '@shared/tr'
import { coupChance, DYNAMICS } from './dynamics'
import { hashRoll } from './rng'
import { fitText } from './util'
import { moveWeightOn } from './weight'

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
      body: ({ planted }) => `Tur ${ek(planted, 'de')}ki vergi indiriminin faturası geldi. Hazine harcamaları kısmak zorunda kaldı.`
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
      body: ({ planted }) => `Tur ${ek(planted, 'de')} piyasaya pompalanan para mutfağa ulaştı. Market fiyatları haftalar içinde tırmandı.`
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
      body: ({ planted }) => `Tur ${ek(planted, 'de')} başlayan kemer sıkma meyvesini verdi. Yabancı sermaye yeniden ülkeye yöneldi.`
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
      body: ({ planted, target }) => `Tur ${ek(planted, 'de')} ${target} için başlatılan projeler tamamlandı. Yeni işler ve yollar bölgeyi canlandırdı.`
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
      body: ({ planted }) => `Tur ${ek(planted, 'de')}ki operasyonda tasfiye edilenler medyada ve mahkemelerde hükümete karşı cephe açtı.`
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
      body: ({ planted }) => `Tur ${ek(planted, 'de')} basına uyguladığın baskı unutulmadı. Biriken öfke bugün büyük meydanlarda patladı.`
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
      body: ({ planted }) => `Tur ${ek(planted, 'de')}ki AB başvurusu Brüksel zirvesinde Fransa'nın veto tehdidine takıldı. Süreç en az altı ay donduruldu.`
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
      body: ({ planted }) => `Tur ${ek(planted, 'de')}ki AB üyeliği sonrası "egemenlik elden gidiyor" diyenler meydanları doldurdu.`
    },
    {
      key: 'ab-fonlari',
      dormancy: 'medium',
      likelihood: 'likely',
      actor: 'DEU',
      outcome: 'eu_funds',
      hook: ({ turn }) => `Tur ${turn}: AB üyeliğiyle birlikte uyum fonlarının yolu açıldı.`,
      headline: 'AB fonları akmaya başladı',
      body: ({ planted }) => `Tur ${ek(planted, 'de')}ki üyeliğin ilk somut meyvesi: Berlin'in öncülüğünde uyum fonları serbest bırakıldı.`
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
      body: ({ planted, target }) => `Tur ${ek(planted, 'de')} ${target} ile imzalanan anlaşma meyvesini verdi. Şirketleri yeni fabrikalar için harekete geçti.`
    }
  ],
  sanctions: [
    {
      key: 'karsi-yaptirim',
      dormancy: 'short',
      likelihood: 'likely',
      actor: 'target',
      outcome: 'sanctions',
      hook: ({ turn, target }) => `Tur ${turn}: yaptırım kararıyla hedef alınan ${target}, karşılık vermek için zamanını bekliyor.`,
      headline: 'Karşı yaptırım geldi',
      body: ({ planted, target }) => `Tur ${ek(planted, 'de')} uyguladığın yaptırıma ${target} aynı sertlikte karşılık verdi.`
    }
  ],
  military_aid: [
    {
      key: 'minnet',
      dormancy: 'long',
      likelihood: 'possible',
      actor: 'target',
      outcome: 'trade_agreement',
      hook: ({ turn, target }) => `Tur ${turn}: askerî yardım gönderilen ${target} bu iyiliği unutmayabilir.`,
      headline: 'Eski dost vefasını gösterdi',
      body: ({ planted, target }) => `Tur ${ek(planted, 'de')} gönderdiğin askerî yardımı unutmayan ${target}, sana ayrıcalıklı bir ticaret anlaşması önerdi.`
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
      body: ({ planted }) => `Tur ${ek(planted, 'de')}ki askerî yığınağa komşular kendi hazırlıklarıyla karşılık verdi. Sınırda gerilim yükseldi.`
    }
  ]
}

/**
 * The world's own developments, by tone. The code (director.ts) decides when one comes and
 * in which tone; the scripted rules pick one of these, preferring the stage the director chose.
 */
interface DevelopmentScript {
  stage: 'home' | 'country' | 'world'
  /** The country behind it, for country-stage scripts. */
  actor?: string
  title: string
  story: string
  moves?: readonly EffectId[]
  impacts?: readonly Impact[]
  lasts?: Lasts
}

const up = (bar: Impact['bar'], size: Impact['size'] = 'small', monthly = false): Impact => ({ bar, change: 'up', size, monthly })
const down = (bar: Impact['bar'], size: Impact['size'] = 'small', monthly = false): Impact => ({ bar, change: 'down', size, monthly })

const DEVELOPMENT_SCRIPTS: Record<Tone, readonly DevelopmentScript[]> = {
  opportunity: [
    {
      stage: 'country',
      actor: 'AZE',
      title: `Bakü'den yeni boru hattı teklifi`,
      story: `Azerbaycan, Avrupa'ya giden gazın bir kolunu Trakya üzerinden geçirmeyi önerdi. Masada transit geliri ve indirimli gaz var.`,
      impacts: [up('reputation'), up('economy')],
      lasts: 'month'
    },
    {
      stage: 'country',
      actor: 'DEU',
      title: `Alman sanayiciler üretim üssü arıyor`,
      story: `Alman otomotiv tedarikçileri Çin'e bağımlılığı azaltmak için yakın coğrafyada fabrika yeri arıyor; Bursa ve Kocaeli listede.`,
      moves: ['foreign_investment']
    },
    {
      stage: 'world',
      title: `Körfez fonları yeniden yolda`,
      story: `Faizlerin gevşemesiyle Körfez varlık fonları gelişmekte olan piyasalara döndü. İstanbul borsasına ilk girişler başladı.`,
      impacts: [up('economy', 'small', true)],
      lasts: 'season'
    },
    {
      stage: 'home',
      title: `Genç yazılımcılar dalgası`,
      story: `İstanbul ve Ankara'daki genç girişimler art arda yatırım aldı. Teknoparklar yeni kira talebine yetişemiyor.`,
      impacts: [up('economy'), up('approval')],
      lasts: 'month'
    }
  ],
  good: [
    {
      stage: 'home',
      title: `Rekor turizm sezonu`,
      story: `Antalya ve Muğla'da oteller haziranın ilk haftasında doldu. Esnaf yüzü gülen bir yaz bekliyor.`,
      impacts: [up('economy', 'clear'), up('approval')],
      lasts: 'month'
    },
    {
      stage: 'world',
      title: `Petrol fiyatları geriledi`,
      story: `Küresel talebin yavaşlamasıyla petrol fiyatları düştü; akaryakıt zamları geri alındı, enerji faturası hafifledi.`,
      impacts: [up('economy', 'small', true), up('welfare')],
      lasts: 'season'
    },
    {
      stage: 'country',
      actor: 'GBR',
      title: `Londra'dan açık destek`,
      story: `İngiltere Dışişleri, Türkiye'nin bölgesel arabuluculuk rolünü öven bir açıklama yaptı.`,
      moves: ['diplomatic_support']
    },
    {
      stage: 'home',
      title: `Bayram havası`,
      story: `Milli maçtaki galibiyetin ardından meydanlar doldu; siyasi gerilim bir haftalığına unutuldu.`,
      moves: ['public_goodwill']
    }
  ],
  neutral: [
    {
      stage: 'home',
      title: `Meclis'te anayasa tartışması`,
      story: `Yeni anayasa taslağı komisyonda saatlerce tartışıldı; muhalefet süreci "aceleye getirilmiş" buldu.`,
      impacts: [down('stability'), up('approval')],
      lasts: 'month'
    },
    {
      stage: 'world',
      title: `Avrupa sandık başında`,
      story: `Komşu ülkelerdeki seçimlerde popülist partiler güçlendi. Ankara'da sonuçların göç politikasına etkisi konuşuluyor.`
    },
    {
      stage: 'country',
      actor: 'RUS',
      title: `Moskova'dan belirsiz sinyaller`,
      story: `Kremlin, Karadeniz'deki tahıl koridoru için yeni bir çerçeve istediğini duyurdu; ayrıntı vermedi.`
    }
  ],
  trouble: [
    {
      stage: 'home',
      title: `Liman işçileri iş bıraktı`,
      story: `Mersin ve İzmir limanlarında işçiler ücret zammı için iş bıraktı; konteynerler rıhtımda bekliyor.`,
      moves: ['strike_wave']
    },
    {
      stage: 'country',
      actor: 'RUS',
      title: `Bankalara siber saldırı`,
      story: `Üç büyük bankanın sistemleri saatlerce çöktü; izler Rusya bağlantılı bir gruba çıkıyor.`,
      moves: ['cyber_attack']
    },
    {
      stage: 'world',
      title: `Buğday fiyatları tırmandı`,
      story: `Karadeniz'deki kuraklık dünya buğday fiyatlarını sıçrattı; fırıncılar ekmeğe zam için kapıda.`,
      impacts: [down('welfare', 'small', true), down('approval')],
      lasts: 'season'
    },
    {
      stage: 'home',
      title: `İhale skandalı`,
      story: `Bir belediye ihalesindeki ses kayıtları sızdı; muhalefet bakanın istifasını istiyor.`,
      moves: ['scandal']
    }
  ]
}

const SCRIPTS_BY_KEY = new Map(Object.values(SEED_SCRIPTS).flat().map((s) => [s.key, s] as const))

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

/**
 * Turns a typed order into one catalog decision, or into free advice. Never spends capital
 * itself. `pending` = decisions already picked this turn, so the answer accounts for them.
 */
export function interpretOrder(state: GameState, text: string, pending: readonly Decision[] = []): Interpretation {
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

  const issues = checkDecision(state, match.effectId, target, pending)
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
  const hint = adviceHint(state, me.bars, turnsLeft)
  const asking = /\?|durum|rapor|öneri|ne yap|tavsiye|anket|nasıl/.test(haystack)
  if (asking) return `${status} ${hint}`
  return (
    'Bu emri elimizdeki kararlardan birine çeviremedim. Örnekler: "vergileri indir", "Yunanistan ile ticaret anlaşması yap", ' +
    `"AB'ye başvur", "İzmir'e yatırım yap". ${status}`
  )
}

/** The one thing the advisor would say right now, most urgent first. */
function adviceHint(state: GameState, bars: Bars, turnsLeft: number): string {
  const risk = coupChance(bars.stability)
  const margin = bars.approval - state.election.threshold
  if (risk > 0) {
    return `Kışlalar huzursuz: darbe riski %${Math.round(risk * 100)}. İstikrarı ${DYNAMICS.coupThreshold} üstüne çıkarmadan başka hiçbir şey önemli değil.`
  }
  if (turnsLeft <= 3 && margin < 3) {
    return 'Sandık kapıda. Halkı hemen memnun eden adımlar şimdi işe yarar; faturası seçimden sonra gelir.'
  }
  if (turnsLeft <= 3) return 'Sandık kapıda ve öndeyiz. Riskli adımları seçimden sonraya bırakmak akıllıca olur.'
  if (bars.stability < 45) return 'İstikrar zayıflıyor. Kışlalardaki sesleri hafife almayın.'
  if (turnsLeft >= 9 && margin < 5) {
    return 'Seçime daha zaman var. Acı ama uzun vadede kazandıran adımlar için en uygun dönem bu; halk unutur, ekonomi hatırlar.'
  }
  if (bars.economy < 40) return 'En zayıf halkamız ekonomi. Ticaret ve yatırım düşünebilirsiniz; teşvik hızlıdır ama bedeli ağırdır.'
  if (bars.welfare < bars.economy - 5) return 'Ekonomi büyüyor ama halkın cebine yansımadı. Refah artmadan onay kalıcı olarak yükselmez.'
  if (margin >= 5) return 'Durum iyi. Kazanılmış güveni harcamadan, seçime kadar dengeyi korumak yeter.'
  return 'Halkın cebi zayıf. Refah artmadan onay kalıcı olarak yükselmez.'
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
  /** The month's decisions; a recorded reason (e.g. from the AI's reading of an order) is kept. */
  decisions: readonly (Decision & { reason?: string })[]
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
    reason: fitText(d.reason ?? `${EFFECTS[d.effectId].label} kararı${d.target.id === player ? '' : ` (${name(d.target)})`}.`, LIMITS.reasonChars)
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
  for (const d of input.decisions) {
    for (const script of SEED_SCRIPTS[d.effectId] ?? []) {
      if (newSeeds.length >= LIMITS.newSeeds) break
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
  const seedHeadlines: string[] = []
  const seedLines: string[] = []
  const used = new Set<string>()
  for (const seed of input.plan.firing) {
    const { outcome, headline } = resolveSeed(state, seed, used, input.plan.seedTone)
    seedOutcomes.push(outcome)
    seedLines.push(outcome.reason)
    if (headline) seedHeadlines.push(headline)
  }

  // The world's own development, when the code planned one this month (never a move already used this month).
  const developments: Development[] = []
  const developmentLines: string[] = []
  const beat = input.plan.beat ?? null
  if (beat) {
    const development = scriptedDevelopment(state, beat, turn, used)
    developments.push(development)
    developmentLines.push(development.story)
  }

  const turnsLeft = state.election.nextTurn - turn
  const decisionLabels = input.decisions.map((d) => EFFECTS[d.effectId].label.toLocaleLowerCase('tr'))
  // A consequence coming back is part of the month's story, told with where it came from.
  const body = [
    ...seedLines,
    decisionLabels.length > 0
      ? `Hükümet bu ay şu adımları attı: ${decisionLabels.join(', ')}.`
      : quietLine(state),
    ...reactionLines,
    ...developmentLines,
    turnsLeft > 0 && turnsLeft <= 3 ? `Seçime ${turnsLeft} ay kaldı.` : '',
    turnsLeft === 0 ? 'Seçmen bu ay sandığa gidiyor; hükümetin kaderi oy pusulalarında.' : ''
  ]
    .filter(Boolean)
    .join(' ')

  const firstDecision = input.decisions[0]
  const electionDay = turnsLeft === 0
  const headline =
    seedHeadlines[0] ??
    (electionDay ? 'Türkiye sandık başında' : undefined) ??
    (firstDecision ? HEADLINES[firstDecision.effectId] : undefined) ??
    developments[0]?.title ??
    quietHeadline(state, turn)

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
    developments,
    narration: { headline: headline.slice(0, 120), body: body.slice(0, 1500) }
  }
}

/** A month without decisions still has news: where the polls stand, what is still running. */
function quietHeadline(state: GameState, turn: number): string {
  const me = findCountry(state, state.playerCountryId)
  const turnsLeft = state.election.nextTurn - turn
  if (me && turnsLeft > 0 && turnsLeft <= 3) return `Seçime ${turnsLeft} ay: kulisler hareketli`
  if (me && me.bars.approval >= state.election.threshold + 5) return 'Anketlerde iktidar rahat'
  if (me && me.bars.approval < state.election.threshold - 10) return 'Muhalefet anketlerde açık ara önde'
  if (me && me.bars.approval < state.election.threshold - 3) return 'Muhalefet anketlerde önde'
  const pool = ["Ankara'da sakin bir ay", 'Gözler anketlerde', 'Hükümet bekle-gör modunda', 'Kulislerde sessizlik']
  return pool[Math.floor(hashRoll(`${state.gameId}|quiet|${turn}`) * pool.length)]!
}

function quietLine(state: GameState): string {
  const me = findCountry(state, state.playerCountryId)
  const running = state.effects.filter((e) => e.actor === state.playerCountryId && e.source === 'player').length
  return [
    'Ankara bu ay yeni bir adım atmadı.',
    running > 0 ? 'Daha önce alınan kararların etkisi sürüyor.' : '',
    me ? `Son ankette iktidar %${me.bars.approval}.` : ''
  ]
    .filter(Boolean)
    .join(' ')
}

function resolveSeed(
  state: GameState,
  seed: Seed,
  used: Set<string>,
  tone?: ConsequenceTone
): { outcome: SeedOutcome; headline?: string } {
  const player = state.playerCountryId
  const script = SCRIPTS_BY_KEY.get(seed.tags[0] ?? '')
  // A hook the AI planted may already fill the whole length a reason allows.
  const storyOnly = (reason: string): { outcome: SeedOutcome } => ({
    outcome: {
      seedId: seed.id,
      actor: null,
      effectId: null,
      target: null,
      reason: fitText(reason, LIMITS.reasonChars),
      title: 'Geçmişin yankısı',
      impacts: [],
      lasts: 'month'
    }
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
  // The code rolled the tone it comes back in; the scripted rules have no story of the other
  // colour, so such a consequence is only told (Claude writes one in the rolled tone).
  if (tone && !consequenceFits(tone, moveWeightOn(state, script.outcome, effectActor, target, player))) {
    return storyOnly(`Geçmişten bir yankı: ${seed.hook}`)
  }
  used.add(`${script.outcome}|${effectActor}`)
  return {
    outcome: { seedId: seed.id, actor: actorId, effectId: script.outcome, target, reason: body, title: script.headline, impacts: [], lasts: 'month' },
    headline: script.headline
  }
}

/** A development of the planned tone, preferring the stage the director chose. */
function scriptedDevelopment(state: GameState, beat: Beat, turn: number, used: ReadonlySet<string>): Development {
  const player = state.playerCountryId
  // A unique move already running (or already used this month) between the same pair cannot start again.
  const running = (id: EffectId, actor: string): boolean =>
    EFFECTS[id].unique &&
    (used.has(`${id}|${actor}`) || state.effects.some((e) => e.effectId === id && e.actor === actor && e.target.type === 'country' && e.target.id === player))
  const pool = DEVELOPMENT_SCRIPTS[beat.tone].filter(
    (d) => (!d.actor || (d.actor !== player && findCountry(state, d.actor))) && !(d.moves ?? []).some((id) => running(id, d.actor ?? player))
  )
  const onStage = pool.filter((d) => d.stage === beat.stage.kind)
  const choices = onStage.length > 0 ? onStage : pool.length > 0 ? pool : DEVELOPMENT_SCRIPTS.neutral.filter((d) => !d.moves)
  const script = choices[Math.floor(hashRoll(`${state.gameId}|development|${turn}`) * choices.length)]!
  return {
    title: script.title,
    story: script.story,
    actor: script.actor ?? null,
    target: countryRef(player),
    moves: [...(script.moves ?? [])],
    impacts: [...(script.impacts ?? [])],
    lasts: script.lasts ?? 'month'
  }
}

function uniqueRefs(refs: readonly EntityRef[]): EntityRef[] {
  return refs.filter((r, i) => refs.findIndex((o) => entityKey(o) === entityKey(r)) === i)
}
