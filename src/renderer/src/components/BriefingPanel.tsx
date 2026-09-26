import { useEffect, useMemo, useRef } from 'react'
import type { ChatEntry, FeedEvent, GameView } from '@shared/game/view'
import { ek } from '@shared/tr'
import { lineTone, monthYear, prettyLine } from '../lib/format'
import type { LiveChat, LiveTurn } from '../lib/useGame'

// News first, then what it changed, then the small print. Order events are left out:
// the decisions and the conversation already say what the player asked for.
const ORDER: Partial<Record<FeedEvent['kind'], number>> = {
  narration: 0,
  seed_fired: 1,
  election: 2,
  coup: 2,
  warning: 3,
  effect_applied: 4,
  foreign_action: 5,
  effect_expired: 6
}

interface TurnGroup {
  turn: number
  date: string
  events: FeedEvent[]
  chat: ChatEntry[]
}

interface Props {
  view: GameView
  liveChat: LiveChat | null
  liveTurn: LiveTurn | null
}

export function BriefingPanel({ view, liveChat, liveTurn }: Props): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)
  const groups = useMemo(() => groupByTurn(view), [view])
  const lastKey = `${view.turn}:${view.feed.length}:${view.chat.length}:${liveChat?.reply.length ?? -1}:${liveChat?.rejected.length ?? 0}:${liveTurn?.narration.length ?? -1}:${liveTurn?.phase ?? ''}`

  // Follow the newest news.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [lastKey])

  return (
    <aside className="briefing" aria-label="Brifing">
      <header className="panel-head">
        <span className="eyebrow">Brifing</span>
        <span className="panel-head__meta">haberler ve danışman</span>
      </header>

      <div className="briefing__list" ref={listRef}>
        {groups.map((g) => (
          <section key={g.turn} className="turn">
            <h2 className="turn__head">
              <span>{g.turn === 0 ? 'Başlangıç' : `Tur ${g.turn}`}</span>
              <time>{monthYear(g.date)}</time>
            </h2>
            {g.turn === 0 && g.events.length === 0 && <Welcome view={view} />}
            {g.events.map((e) => (
              <FeedItem key={e.id} event={e} />
            ))}
            {g.chat.map((c) => (
              <Chat key={c.id} entry={c} />
            ))}
            {g.turn === view.turn && liveChat && <LiveChatBubble chat={liveChat} />}
          </section>
        ))}
        {liveTurn && <TurnInProgress turn={liveTurn} next={view.turn + 1} />}
      </div>
    </aside>
  )
}

function groupByTurn(view: GameView): TurnGroup[] {
  const groups = new Map<number, TurnGroup>()
  const group = (turn: number, date: string): TurnGroup => {
    let g = groups.get(turn)
    if (!g) groups.set(turn, (g = { turn, date, events: [], chat: [] }))
    return g
  }
  for (const e of view.feed) {
    if (ORDER[e.kind] === undefined) continue
    group(e.turn, e.date).events.push(e)
  }
  // Talk happens while planning the next turn, so it sits under the news it reacts to.
  for (const c of view.chat) group(c.turn, c.turn === view.turn ? view.date : (groups.get(c.turn)?.date ?? view.date)).chat.push(c)
  if (groups.size === 0 || view.turn === 0) group(view.turn, view.date)
  for (const g of groups.values()) g.events.sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9))
  return [...groups.values()].sort((a, b) => a.turn - b.turn)
}

function FeedItem({ event: e }: { event: FeedEvent }): React.JSX.Element {
  switch (e.kind) {
    case 'narration':
      return (
        <article className="news">
          <h3 className="news__headline">{e.title}</h3>
          <p className="news__body">{e.summary}</p>
        </article>
      )
    case 'seed_fired': {
      const butterfly = e.origin?.butterfly ?? true
      return (
        <article className={`echo ${butterfly ? 'echo--butterfly' : 'echo--world'}`}>
          <span className="echo__tag">{butterfly ? 'Kelebek etkisi' : 'Dünya gündemi'}</span>
          <h3 className="echo__title">{e.title.replace(/^(Kelebek etkisi|Dünya gündemi): /, '')}</h3>
          <p className="echo__body">{e.summary}</p>
          {e.origin && (
            <p className="echo__origin">
              {butterfly ? `Kaynağı: Tur ${e.origin.turn} · ${e.origin.label}` : `Tur ${ek(e.origin.turn, 'de')} haberlere düşmüştü`}
            </p>
          )}
        </article>
      )
    }
    case 'election':
      return (
        <article className={`verdict ${e.title.startsWith('Seçim kazanıldı') ? 'verdict--won' : 'verdict--lost'}`}>
          <span className="eyebrow">Sandık</span>
          <h3>{e.title}</h3>
          <p>{e.summary}</p>
        </article>
      )
    case 'coup':
      return (
        <article className="verdict verdict--lost">
          <span className="eyebrow">Darbe</span>
          <h3>{e.title}</h3>
          <p>{e.summary}</p>
        </article>
      )
    case 'warning':
      return (
        <article className="warn">
          <strong>{e.title}</strong>
          <span>{e.summary}</span>
        </article>
      )
    case 'effect_applied':
      return (
        <p className="line line--decision">
          <span className="line__mark">✓</span>
          {e.title}
        </p>
      )
    case 'foreign_action':
      return (
        <p className="line line--foreign" title={e.summary}>
          <span className="line__mark">◆</span>
          {e.summary}
        </p>
      )
    default:
      return <p className="line line--faint">{e.title}</p>
  }
}

function Chat({ entry: c }: { entry: ChatEntry }): React.JSX.Element {
  return (
    <div className={`chat chat--${c.kind}`}>
      <p className="chat__you">{c.text}</p>
      {c.rejected.map((r, i) => (
        <Rejected key={i} reply={r.reply} reasons={r.reasons} />
      ))}
      <div className="chat__reply">
        <span className="chat__who">{c.kind === 'talk' ? 'Danışman · bedava' : 'Kabine'}</span>
        {c.reply}
        {c.decisions.length > 0 && (
          <ul className="chat__moves">
            {c.decisions.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
        {c.discussed.map((d) => (
          <div key={d.label} className="chat__preview">
            <span>{d.label}</span>
            {d.lines.map((l) => (
              <span key={l} className={`chip chip--${lineTone(l)}`}>
                {prettyLine(l)}
              </span>
            ))}
          </div>
        ))}
        {c.fallback && <span className="chat__fallback">Yedek cevap: Claude'a ulaşılamadı.</span>}
      </div>
    </div>
  )
}

/** A proposal the referee turned down before the final answer. */
function Rejected({ reply, reasons }: { reply: string; reasons: string[] }): React.JSX.Element {
  return (
    <div className="chat__rejected">
      <p className="chat__rejected-reply">{reply}</p>
      <p className="chat__referee">
        <span className="chat__who chat__who--referee">Hakem reddetti</span>
        {reasons.join(' · ')}
      </p>
    </div>
  )
}

function LiveChatBubble({ chat }: { chat: LiveChat }): React.JSX.Element {
  return (
    <div className="chat chat--live">
      <p className="chat__you">{chat.text}</p>
      {chat.rejected.map((r, i) => (
        <Rejected key={i} reply={r.reply} reasons={r.reasons} />
      ))}
      <p className="chat__reply">
        <span className="chat__who">Kabine</span>
        {chat.reply || <span className="thinking">düşünüyor</span>}
        {chat.reply && <span className="caret" aria-hidden="true" />}
      </p>
    </div>
  )
}

const PHASES: Record<NonNullable<LiveTurn['phase']>, string> = {
  world: 'Dünya hamlesini düşünüyor',
  referee: 'Hakem kontrol ediyor',
  news: 'Haber yazılıyor'
}

/** The month being played out: steps, then the news streaming in. */
function TurnInProgress({ turn, next }: { turn: LiveTurn; next: number }): React.JSX.Element {
  const [headline, ...rest] = turn.narration.split('\n')
  return (
    <section className="turn turn--live" aria-live="polite">
      <h2 className="turn__head">
        <span>Tur {next}</span>
        <span className="turn__phase">{turn.phase ? PHASES[turn.phase] : 'Başlıyor'}</span>
      </h2>
      <article className="news news--live">
        {turn.narration ? (
          <>
            <h3 className="news__headline">{headline}</h3>
            <p className="news__body">
              {rest.join('\n').trim()}
              <span className="caret" aria-hidden="true" />
            </p>
          </>
        ) : (
          <p className="news__body thinking">{turn.phase ? PHASES[turn.phase] : 'Ay başlıyor'}</p>
        )}
      </article>
    </section>
  )
}

function Welcome({ view }: { view: GameView }): React.JSX.Element {
  const approval = view.player.bars.find((b) => b.id === 'approval')?.value ?? 0
  return (
    <article className="news news--welcome">
      <h3 className="news__headline">Ankara'da yeni dönem</h3>
      <p className="news__body">
        {view.player.name}'nin başındasın. Seçime {view.player.election.turnsLeft} ay var; anketler %{approval}, baraj %
        {view.player.election.threshold}. Her ay {view.player.capital.max} siyasi sermayen var, her karar 1 puan. Danışmanla konuşmak
        bedava.
      </p>
      <p className="news__body news__body--hint">
        Kararların geri döner: bazıları aylar sonra. İstikrar çok düşerse ordu kapıyı çalar.
      </p>
    </article>
  )
}
