import type { EffectId } from './catalog'

// The world book: the 2026 world as the game's scenario sees it. Written once and frozen
// (shipped with the game, never regenerated per turn), so every turn reads the same book
// and it can sit in the cached part of the prompt. English, because only Claude reads it;
// everything the player sees is written in Turkish.
//
// It is a game scenario for January 2026, not a news source. Leaders are named by office
// ("the Kremlin", "Washington"), never by person, so the book does not age with elections.

export interface WorldBookEntry {
  /** How the country tends to treat Türkiye at the start. */
  stance: 'ally' | 'partner' | 'rival' | 'wary' | 'hostile'
  /** What it wants in 2026, in one or two sentences. */
  agenda: string
  /** How it sees Türkiye, and what would make it act. */
  onTurkey: string
  /** Catalog moves it typically uses toward Türkiye (a hint, not a rule). */
  levers: readonly EffectId[]
}

export const WORLD_ERA = [
  'January 2026. Great-power rivalry is the frame: the United States and China compete over trade and technology, Russia is isolated from the West and leans on China, India and energy buyers.',
  'The war in Ukraine has worn both sides down; talk of a ceasefire comes and goes, sanctions on Russia stay.',
  'The Middle East is volatile: Israel’s wars with its neighbours have not settled, Syria is rebuilding after the fall of its old regime under a fragile new government, Iran is under pressure.',
  'Europe worries about energy, migration and defence spending; populist parties are strong.',
  'Türkiye sits in the middle of all of it: NATO member, EU candidate with a frozen process, energy hub ambitions, a big army and a strained economy with high inflation.'
] as const

export const WORLD_BOOK: Readonly<Record<string, WorldBookEntry>> = {
  USA: {
    stance: 'partner',
    agenda: 'Contain China, keep NATO paying for its own defence, avoid new wars, use tariffs as a weapon.',
    onTurkey: 'Needed NATO ally at the Straits, but distrusted over Russian arms and Syria. Rewards cooperation with trade and arms deals; punishes deals with Russia with sanctions.',
    levers: ['sanctions', 'tariff_hike', 'arms_embargo', 'trade_agreement', 'diplomatic_support', 'defense_pact']
  },
  RUS: {
    stance: 'wary',
    agenda: 'Hold its gains in Ukraine, break Western isolation, keep selling energy, keep Türkiye out of the Western camp.',
    onTurkey: 'A useful partner and customer (gas, tourism, nuclear plant) and a rival in the Black Sea, Syria and the Caucasus. Uses energy as a lever: discounts for friends, cut-offs for those who side with the West.',
    levers: ['energy_cutoff', 'energy_discount', 'tourism_boycott', 'cyber_attack', 'military_threat', 'backchannel_talks']
  },
  CHN: {
    stance: 'partner',
    agenda: 'Win the tech race, secure trade routes and markets, avoid Western sanctions, expand the Belt and Road.',
    onTurkey: 'A market and a trade corridor. Offers investment and loans; bristles at criticism over the Uyghurs.',
    levers: ['foreign_investment', 'trade_agreement', 'tariff_hike', 'diplomatic_protest']
  },
  DEU: {
    stance: 'partner',
    agenda: 'Revive a stagnant economy, rearm, keep migration down, hold the EU together.',
    onTurkey: 'Biggest trade partner and home of the Turkish diaspora. Wants Türkiye to hold migrants back; loud on press freedom and rule of law.',
    levers: ['foreign_investment', 'diplomatic_protest', 'eu_funds', 'arms_embargo', 'trade_agreement']
  },
  FRA: {
    stance: 'wary',
    agenda: 'European strategic autonomy, influence in the Mediterranean and Africa, a domestic political crisis at home.',
    onTurkey: 'A rival in the Eastern Mediterranean, Libya and the Caucasus. The most likely capital to block Türkiye’s EU path.',
    levers: ['eu_process_frozen', 'diplomatic_protest', 'arms_embargo', 'defense_pact']
  },
  GBR: {
    stance: 'partner',
    agenda: 'Post-Brexit trade deals, a bigger defence role in Europe, support for Ukraine.',
    onTurkey: 'Friendly: a free-trade partner and a defence-industry partner (jets). Pragmatic, rarely lectures.',
    levers: ['trade_agreement', 'defense_pact', 'arms_purchase', 'diplomatic_support']
  },
  GRC: {
    stance: 'rival',
    agenda: 'Protect its islands and sea claims, keep the EU and US on its side, grow tourism and shipping.',
    onTurkey: 'Neighbour and historic rival over the Aegean, airspace, Cyprus and gas fields; calm periods alternate with crises. Answers military moves with alarm in Brussels and Washington.',
    levers: ['diplomatic_protest', 'naval_show_of_force', 'military_buildup', 'defense_pact', 'recall_ambassador']
  },
  IRN: {
    stance: 'wary',
    agenda: 'Regime survival under sanctions, keep its regional network alive, avoid a war with Israel and the US.',
    onTurkey: 'A trading neighbour and energy supplier, a rival in Syria, Iraq and the Caucasus. Avoids open conflict with Ankara.',
    levers: ['energy_cutoff', 'energy_discount', 'diplomatic_protest', 'border_incident', 'trade_agreement']
  },
  SYR: {
    stance: 'partner',
    agenda: 'A fragile post-war government trying to rebuild, unify the country and get sanctions lifted.',
    onTurkey: 'Its most important neighbour and backer; millions of Syrian refugees still live in Türkiye. Kurdish armed groups in the north-east are Ankara’s red line.',
    levers: ['refugee_wave', 'border_incident', 'diplomatic_support', 'trade_agreement']
  },
  IRQ: {
    stance: 'partner',
    agenda: 'Balance Iran and the US, sell oil, rebuild, keep the Kurdish region in check.',
    onTurkey: 'Trade and water partner; the Development Road corridor to the Gulf. Protests Turkish operations against militants in its north.',
    levers: ['diplomatic_protest', 'trade_agreement', 'energy_deal', 'border_incident']
  },
  ISR: {
    stance: 'hostile',
    agenda: 'Security first: wars on several fronts, containing Iran, normalising with Gulf states.',
    onTurkey: 'Relations are broken over Gaza; trade is cut. Sees Ankara as hostile and watches Turkish influence in Syria closely.',
    levers: ['diplomatic_protest', 'cyber_attack', 'military_threat', 'arms_embargo']
  },
  SAU: {
    stance: 'partner',
    agenda: 'Diversify away from oil, big investment projects, regional leadership, stability above all.',
    onTurkey: 'Reconciled after years of rivalry; invests and buys Turkish drones. Rewards stability, dislikes Islamist politics.',
    levers: ['foreign_investment', 'arms_purchase', 'diplomatic_support', 'energy_deal']
  },
  AZE: {
    stance: 'ally',
    agenda: 'Consolidate its win over Karabakh, sell gas to Europe, open the corridor to Türkiye through Armenia.',
    onTurkey: '"One nation, two states": the closest ally. Offers gas deals and diplomatic backing; expects Turkish support against Armenia and Iran.',
    levers: ['energy_discount', 'energy_deal', 'diplomatic_support', 'defense_pact']
  },
  EGY: {
    stance: 'wary',
    agenda: 'Keep a strained economy afloat with Gulf and IMF money, security in Sinai and Libya.',
    onTurkey: 'Normalised after a decade of hostility; rivals in Libya and over sea borders, partners in trade.',
    levers: ['diplomatic_protest', 'trade_agreement', 'diplomatic_support']
  },
  UKR: {
    stance: 'partner',
    agenda: 'Survive the war, get Western weapons and money, a ceasefire on acceptable terms, EU membership.',
    onTurkey: 'Buys Turkish drones and values Ankara as a mediator with Moscow; upset by Turkish trade with Russia.',
    levers: ['arms_purchase', 'diplomatic_support', 'peace_mediation', 'diplomatic_protest']
  }
}

/** The book's entries for these countries, in the given order (unknown ids are skipped). */
export function worldBookFor(ids: readonly string[]): Array<{ id: string } & WorldBookEntry> {
  return ids.flatMap((id) => {
    const entry = WORLD_BOOK[id]
    return entry ? [{ id, ...entry }] : []
  })
}
