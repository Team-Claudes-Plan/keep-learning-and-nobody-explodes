import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { fetchLobbies } from '../api/client'
import {
  acquireSession,
  createSession,
  isOver,
  releaseSession,
  storedCredentials,
  useSession,
  type Briefing,
  type SessionClient,
  type SessionState,
} from '../api/session'
import type { EndReason, IslandsResponse, Lobby, Role } from '../api/types'
import { reloadIslands, useIslands } from '../api/useIslands'
import Bomb3D from '../game/Bomb3D'
import Celebration from '../game/Celebration'
import GlyphIcon from '../game/GlyphIcon'
import { QUESTION_TYPE_LABELS } from '../game/questionTypes'
import { sessionErrorText } from '../game/sessionErrors'
import { useSessionBomb, useTimeLeft } from '../game/useSessionBomb'
import { CopyLink } from './KoopPages'

// Koop over the backend's game session (schema/session-protocol.md): the server picks the
// questions, runs the timer and judges answers. Each turn one player defuses one module and the
// other reads the manual page; the roles swap after every turn.

const ROLE_LABELS: Record<Role, string> = { defuser: '💣 Entschärfer', expert: '📖 Experte' }
const MAX_PARTS = 11
const LOBBY_REFRESH_MS = 5000

const gamePath = (gameId: string) => `/koop/spiel/${gameId}`

/** Names of everyone on the user's islands, by user id. */
function useNames(): Map<string, string> {
  const islands = useIslands()
  return useMemo(() => {
    const names = new Map<string, string>()
    if (islands.status !== 'ready') return names
    names.set(islands.data.me.id, islands.data.me.name)
    for (const island of islands.data.islands) for (const member of island.group.members) names.set(member.id, member.name)
    return names
  }, [islands])
}

/** House names by topic id, over all islands. */
function topicNames(data: IslandsResponse | null): Map<string, string> {
  const names = new Map<string, string>()
  for (const island of data?.islands ?? []) for (const house of island.houses) names.set(house.topic_id, house.name)
  return names
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/** /koop with a backend: start a game on an island's houses, or join one. */
export function SessionLobbyPage() {
  const islands = useIslands()
  const navigate = useNavigate()
  const data = islands.status === 'ready' ? islands.data : null

  const [islandId, setIslandId] = useState<string | null>(null)
  const island = data?.islands.find((entry) => entry.id === islandId) ?? data?.islands[0] ?? null
  const [topics, setTopics] = useState<Set<string> | null>(null)
  const chosen = topics ?? new Set(island?.houses.map((house) => house.topic_id) ?? [])
  const [questionCount, setQuestionCount] = useState(5)
  const [role, setRole] = useState<Role | ''>('')
  const [minutes, setMinutes] = useState(5)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState('')

  const [lobbies, setLobbies] = useState<Lobby[] | null>(null)
  const [lobbyError, setLobbyError] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const load = () =>
      fetchLobbies(controller.signal).then(
        (list) => {
          setLobbies(list)
          setLobbyError(null)
        },
        (err: unknown) => !controller.signal.aborted && setLobbyError(errorText(err)),
      )
    void load()
    const id = setInterval(load, LOBBY_REFRESH_MS)
    return () => {
      clearInterval(id)
      controller.abort()
    }
  }, [])

  async function create() {
    setCreating(true)
    setError(null)
    try {
      const gameId = await createSession({
        topics: [...chosen],
        questionCount,
        role: role || undefined,
        timeLimitSecs: minutes * 60,
      })
      navigate(gamePath(gameId))
    } catch (err) {
      setError(errorText(err))
      setCreating(false)
    }
  }

  const names = topicNames(data)

  return (
    <div className="mg-page">
      <header className="mg-header">
        <h1>🤝 Koop</h1>
        <Link to="/minigames">← Minigames</Link>
      </header>
      <p className="mg-muted">
        Zu zweit: In jeder Runde entschärft einer ein Modul, der andere liest im Handbuch nach. Nach jeder Runde
        tauscht ihr die Rollen. Drei Fehler oder die Zeit läuft ab: Boom.
      </p>

      {islands.status === 'signed-out' && (
        <p>
          Du bist nicht angemeldet. <Link to="/islands">Zu den Inseln</Link>
        </p>
      )}
      {islands.status === 'error' && <p className="bomb-error">⚠️ {islands.message}</p>}

      <section className="session-panel">
        <h2>Neues Spiel</h2>
        {data && data.islands.length === 0 && <p className="mg-muted">Du hast noch keine Insel mit Häusern.</p>}
        {data && island && (
          <>
            <label className="koop-seed">
              Insel
              <select
                className="mg-select"
                value={island.id}
                onChange={(e) => {
                  setIslandId(e.target.value)
                  setTopics(null)
                }}
              >
                {data.islands.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="session-topics">
              <legend>Häuser (Themen)</legend>
              {island.houses.length === 0 && <span className="mg-muted">Auf dieser Insel stehen noch keine Häuser.</span>}
              {island.houses.map((house) => (
                <label key={house.topic_id}>
                  <input
                    type="checkbox"
                    checked={chosen.has(house.topic_id)}
                    onChange={(e) => {
                      const next = new Set(chosen)
                      if (e.target.checked) next.add(house.topic_id)
                      else next.delete(house.topic_id)
                      setTopics(next)
                    }}
                  />{' '}
                  {house.name}
                </label>
              ))}
            </fieldset>
            <div className="koop-seed session-options">
              <label>
                Module{' '}
                <select className="mg-select" value={questionCount} onChange={(e) => setQuestionCount(Number(e.target.value))}>
                  {Array.from({ length: MAX_PARTS }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Zeit{' '}
                <select className="mg-select" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                  {[2, 3, 5, 10, 15, 30].map((n) => (
                    <option key={n} value={n}>
                      {n} min
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Ich starte als{' '}
                <select className="mg-select" value={role} onChange={(e) => setRole(e.target.value as Role | '')}>
                  <option value="">egal</option>
                  <option value="defuser">{ROLE_LABELS.defuser}</option>
                  <option value="expert">{ROLE_LABELS.expert}</option>
                </select>
              </label>
            </div>
            <button className="mg-button mg-primary" disabled={creating || chosen.size === 0} onClick={() => void create()}>
              {creating ? 'Erstelle…' : 'Spiel erstellen'}
            </button>
            {error && <p className="bomb-error">⚠️ {error}</p>}
          </>
        )}
      </section>

      <section className="session-panel">
        <h2>Beitreten</h2>
        <form
          className="koop-seed"
          onSubmit={(e) => {
            e.preventDefault()
            const id = code.trim().split('/').pop()
            if (id) navigate(gamePath(id))
          }}
        >
          <input
            className="mg-select session-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Link oder Spiel-ID vom Mitspieler"
            aria-label="Spiel-ID"
          />
          <button className="mg-button" type="submit" disabled={!code.trim()}>
            Beitreten
          </button>
        </form>
        {lobbyError && <p className="bomb-error">⚠️ {lobbyError}</p>}
        {lobbies && lobbies.length === 0 && <p className="mg-muted">Gerade wartet kein Spiel auf Mitspieler.</p>}
        <ul className="session-lobbies">
          {lobbies?.map((lobby) => {
            const mine = storedCredentials(lobby.id) !== null
            const topicsLabel = lobby.topics.map((id) => names.get(id) ?? 'Unbekanntes Thema').join(', ')
            return (
              <li key={lobby.id}>
                <span>
                  <strong>{topicsLabel || 'Spiel'}</strong>
                  <span className="mg-muted">
                    {' '}
                    · {lobby.question_count} Module
                    {lobby.open_role && ` · frei: ${ROLE_LABELS[lobby.open_role]}`}
                  </span>
                </span>
                <Link className="mg-button" to={gamePath(lobby.id)}>
                  {mine ? 'Dein Spiel öffnen' : 'Beitreten'}
                </Link>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

/**
 * /koop/spiel/:gameId — joins the game (or resumes it with the stored token) and plays it.
 * `?rolle=` is the role to join as, `?insel=` the island of a storey game, to lead back to its house.
 */
export function SessionGamePage() {
  const { gameId = '' } = useParams()
  const [params] = useSearchParams()
  const role = params.get('rolle')
  const islandId = params.get('insel')
  const [client, setClient] = useState<SessionClient | null>(null)

  useEffect(() => {
    const next = acquireSession(gameId, role === 'defuser' || role === 'expert' ? role : undefined)
    setClient(next)
    return () => releaseSession(next)
  }, [gameId, role])

  if (!client) return null
  return <SessionGame key={gameId} client={client} islandId={islandId} />
}

const REASONS: Record<EndReason, string> = {
  all_resolved: 'Alle Module erledigt.',
  strikes: 'Drei Fehler.',
  timeout: 'Die Zeit ist abgelaufen.',
  forfeit: 'Jemand hat aufgegeben.',
}

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** A short note after every answer: right or wrong. Shown for a few seconds. */
function useAnswerToast(session: SessionState) {
  const [toast, setToast] = useState<boolean | null>(null)
  const { lastAnswer } = session
  useEffect(() => {
    if (!lastAnswer) return
    setToast(lastAnswer.correct)
    const id = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(id)
  }, [lastAnswer])
  return toast
}

/** Where to go after the game: the storey's house, or the lobby. */
function resultTarget(game: { skill_id: string | null; topics: string[] }, islandId: string | null) {
  if (game.skill_id && islandId && game.topics[0]) {
    return { to: `/islands/${islandId}/houses/${game.topics[0]}`, label: 'Zurück zum Haus' }
  }
  return { to: '/koop', label: 'Zurück zur Lobby' }
}

function SessionGame({ client, islandId }: { client: SessionClient; islandId: string | null }) {
  const session = useSession(client)
  const bomb = useSessionBomb(client, session)
  const names = useNames()
  const { game, playerId, connection } = session
  const me = playerId
  const myRole: Role | null = !game || !me ? null : game.defuser === me ? 'defuser' : game.expert === me ? 'expert' : null
  const timeLeft = useTimeLeft(game?.deadline ?? null, game?.status === 'active', 0)
  const toast = useAnswerToast(session)
  const ended = isOver(game)

  // A won storey unlocks the next one: show the houses as they are now.
  useEffect(() => {
    if (ended) void reloadIslands().catch(() => undefined)
  }, [ended])

  if (connection === 'failed') {
    return (
      <div className="mg-page">
        <h1>🤝 Koop</h1>
        <p className="bomb-error">⚠️ {session.error ? sessionErrorText(session.error) : 'Keine Verbindung.'}</p>
        <Link className="mg-button" to="/koop">
          Zurück
        </Link>
      </div>
    )
  }

  if (!game) {
    return (
      <div className="bomb-screen">
        <p className="bomb-screen-message">Verbinde mit dem Spiel…</p>
      </div>
    )
  }

  const partner = game.players.find((player) => player.player_id !== me)
  const partnerName = partner ? (names.get(partner.player_id) ?? 'Mitspieler') : null

  if (game.status === 'waiting') {
    const url = window.location.origin + gamePath(game.game_id)
    return (
      <div className="mg-page">
        <header className="mg-header">
          <h1>🤝 Warte auf Mitspieler…</h1>
          <Link to="/koop">← Koop</Link>
        </header>
        <p className="mg-muted">Schick deinem Mitspieler diesen Link. Sobald er beitritt, geht es los.</p>
        <p className="koop-links">
          <CopyLink url={url} />
        </p>
        <p className="mg-muted">{game.parts.length} Module</p>
        <ConnectionNote session={session} />
        <button className="mg-button" onClick={() => client.forfeit()}>
          Spiel abbrechen
        </button>
      </div>
    )
  }

  const over = ended
  const result = resultTarget(game, islandId)

  return (
    <div className="bomb-screen" data-role={myRole ?? undefined} data-status={game.status} data-turn={game.turn ?? undefined}>
      {myRole === 'defuser' ? (
        <Bomb3D
          bare
          modules={bomb.bombModules}
          focused={bomb.focused}
          overlay={bomb.focusedOnBomb ? 'side' : 'center'}
          onSelect={bomb.select}
          onBack={bomb.back}
          timeLeft={timeLeft}
          strikes={game.strikes}
          exploded={game.status === 'lost'}
        >
          {bomb.card}
        </Bomb3D>
      ) : (
        <ExpertManual briefing={session.briefing?.role === 'expert' && session.briefing.turn === game.turn ? session.briefing : null} over={over} />
      )}

      <div className="session-bar">
        <span>
          Modul {Math.min((game.turn ?? 0) + 1, game.parts.length)} / {game.parts.length}
        </span>
        {myRole && <strong>{ROLE_LABELS[myRole]}</strong>}
        <span aria-label="Strikes">
          {Array.from({ length: game.max_strikes }, (_, i) => (i < game.strikes ? '✖' : '○')).join(' ')}
        </span>
        <span>⏱ {formatTime(timeLeft)}</span>
        {partnerName && (
          <span className={partner?.online ? 'session-online' : 'session-offline'}>
            ● {partnerName}
            {!partner?.online && ' (offline)'}
          </span>
        )}
        {!over && (
          <button
            className="mg-button"
            onClick={() => {
              if (window.confirm('Wirklich aufgeben? Das Spiel endet für beide.')) client.forfeit()
            }}
          >
            Aufgeben
          </button>
        )}
      </div>
      <ConnectionNote session={session} />
      {bomb.unplayable && myRole === 'defuser' && (
        <p className="bomb-screen-message">Für diese Frage gibt es noch kein passendes Modul.</p>
      )}
      {toast !== null && (
        <div className={`session-toast ${toast ? 'is-good' : 'is-bad'}`}>
          {toast ? '✅ Richtig!' : '❌ Falsch – Strike!'}
          {!over && myRole && ` · Jetzt bist du ${ROLE_LABELS[myRole]}`}
        </div>
      )}

      {game.status === 'won' && <Celebration />}
      {over && (
        <Link to={result.to} className={`bomb-screen-result ${game.status === 'won' ? 'is-good' : 'is-bad'}`}>
          {game.status === 'won' ? '✅ Entschärft' : game.status === 'lost' ? '💥 BOOM' : '🏳️ Abgebrochen'}
          {game.reason && <small>{REASONS[game.reason]}</small>}
          {game.status === 'won' && game.skill_id && <small>Stockwerk geschafft: das nächste ist frei!</small>}
          <small>{result.label}</small>
        </Link>
      )}
    </div>
  )
}

function ConnectionNote({ session }: { session: SessionState }) {
  if (session.connection === 'reconnecting') return <div className="session-note">Verbindung verloren – verbinde neu…</div>
  if (session.connection === 'open' && session.error)
    return <div className="session-note">⚠️ {sessionErrorText(session.error)}</div>
  return null
}

const LIST_LABELS: Record<string, string> = {
  options: 'Antworten',
  statements: 'Aussagen',
  left: 'Links',
  right: 'Rechts',
  categories: 'Gruppen',
  items: 'Elemente',
}

/** The list the defuser sees as symbols, which the symbol table already explains. */
const SYMBOL_FIELD: Record<string, string> = {
  single_choice: 'options',
  multiple_choice: 'options',
  order: 'items',
  grouping: 'items',
  matching: 'right',
}

const asText = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value))

/** The expert's page for this turn: the question, what the symbols mean and the manual entry. */
function ExpertManual({ briefing, over }: { briefing: Extract<Briefing, { role: 'expert' }> | null; over: boolean }) {
  if (!briefing) {
    return (
      <div className="book-screen">
        <p className="book-loading">{over ? 'Spiel vorbei.' : 'Warte auf das Handbuch…'}</p>
      </div>
    )
  }
  const { instruction, symbols } = briefing
  const prompt = briefing.prompt ?? (typeof instruction.prompt === 'string' ? instruction.prompt : null)
  const hidden = symbols?.length ? SYMBOL_FIELD[briefing.question_type] : undefined
  const entries = Object.entries(instruction).filter(([key]) => key !== 'prompt' && key !== hidden)

  return (
    <div className="book-screen">
      <div className="session-manual">
        <article className="book-paper">
          <h2>
            Modul {briefing.turn + 1} · {QUESTION_TYPE_LABELS[briefing.question_type] ?? briefing.question_type}
          </h2>
          <p className="mg-muted">
            Dein Partner sieht die Bombe, aber nicht die Frage. Lies sie vor, lass dir das Modul beschreiben und sag, was
            zu tun ist.
          </p>
          {prompt && (
            <section>
              <h3>Die Frage</h3>
              <p className="book-question">{prompt}</p>
            </section>
          )}
          {symbols && symbols.length > 0 && (
            <section>
              <h3>Bedeutung der Symbole</h3>
              <ul className="book-glyphs">
                {symbols.map(({ glyph, text }) => (
                  <li key={glyph} data-glyph={glyph}>
                    <GlyphIcon index={glyph} size={34} stroke={5} />
                    <span>{asText(text)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {entries.map(([key, value]) => (
            <section key={key}>
              {Array.isArray(value) ? (
                <>
                  <h3>{LIST_LABELS[key] ?? key}</h3>
                  <ol className="book-statements">
                    {value.map((item, i) => (
                      <li key={i}>{asText(item)}</li>
                    ))}
                  </ol>
                </>
              ) : (
                <p>{asText(value)}</p>
              )}
            </section>
          ))}
        </article>
      </div>
    </div>
  )
}
