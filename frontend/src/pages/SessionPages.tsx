import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
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
import BombRoom, { PLAIN_ROOM, StoreyBombRoom, type BombRoomProps } from '../components/storey/BombRoom'
import { useIslandHouse } from '../data/useIslandHouse'
import BlastOverlay from '../game/BlastOverlay'
import Celebration from '../game/Celebration'
import type { Manual } from '../game/briefing'
import { QUESTION_TYPE_LABELS } from '../game/questionTypes'
import { sessionErrorText } from '../game/sessionErrors'
import { useSessionBomb, useTimeLeft } from '../game/useSessionBomb'
import ReadyButton3D from '../components/session/ReadyButton3D'
import { CopyLink } from './KoopPages'
import ManualBook from './ManualBook'

// Koop over the backend's game session (schema/session-protocol.md): the server picks the
// questions, runs the timer and judges answers. One player defuses the modules, the other reads
// the manual pages; the roles hold for the whole bomb.

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
  /** The expert's side of the explosion went off (shakes the book). */
  const [blasted, setBlasted] = useState(false)
  const onBlast = useCallback(() => setBlasted(true), [])

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
  /** Both seats taken, the clock starts once both players are ready. */
  const starting = game.status === 'ready'
  const meReady = game.players.find((player) => player.player_id === me)?.ready ?? false

  return (
    <div className={`bomb-screen ${blasted ? 'is-blasted' : ''}`} data-role={myRole ?? undefined} data-status={game.status} data-turn={game.turn ?? undefined}>
      {myRole === 'defuser' ? (
        <DefuserRoom
          game={game}
          islandId={islandId}
          bomb={bomb}
          timeLeft={timeLeft}
          ready={starting ? <ReadyButton client={client} meReady={meReady} partnerName={partnerName} /> : null}
        />
      ) : (
        <>
          <ExpertBook
            game={game}
            briefing={session.briefing?.role === 'expert' && session.briefing.turn === game.turn ? session.briefing : null}
          />
          {game.status === 'lost' && <BlastOverlay onBlast={onBlast} />}
          {starting && (
            <div className="session-ready">
              <ReadyButton client={client} meReady={meReady} partnerName={partnerName} />
            </div>
          )}
        </>
      )}

      <div className="session-bar">
        <span>
          Modul {Math.min((game.turn ?? 0) + 1, game.parts.length)} / {game.parts.length}
        </span>
        {myRole && <strong>{ROLE_LABELS[myRole]}</strong>}
        <span aria-label="Strikes">
          {Array.from({ length: game.max_strikes }, (_, i) => (i < game.strikes ? '✖' : '○')).join(' ')}
        </span>
        {!starting && <span>⏱ {formatTime(timeLeft)}</span>}
        {partnerName && (
          <span className={partner?.online ? 'session-online' : 'session-offline'}>
            ● {partnerName}
            {!partner?.online && ' (offline)'}
            {starting && partner?.ready && ' · bereit'}
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
      {bomb.unplayable && myRole === 'defuser' && !starting && (
        <p className="bomb-screen-message">Für diese Frage gibt es noch kein passendes Modul.</p>
      )}
      {toast !== null && (
        <div className={`session-toast ${toast ? 'is-good' : 'is-bad'}`}>
          {toast ? '✅ Richtig!' : '❌ Falsch – Strike!'}
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

/** The big green button both players press before the clock starts. */
function ReadyButton({ client, meReady, partnerName }: { client: SessionClient; meReady: boolean; partnerName: string | null }) {
  const [sent, setSent] = useState(false)
  const pressed = meReady || sent
  return (
    <>
      <ReadyButton3D pressed={pressed} onPress={() => setSent(client.ready())} />
      <p className="session-ready-wait">
        {pressed ? `Warte auf ${partnerName ?? 'deinen Mitspieler'}…` : 'Drück auf Bereit, sobald ihr loslegen wollt.'}
      </p>
    </>
  )
}

type DefuserRoomProps = {
  game: NonNullable<SessionState['game']>
  islandId: string | null
  bomb: ReturnType<typeof useSessionBomb>
  timeLeft: number
  /** The ready button, shown until the game starts. */
  ready: ReactNode
}

/** The defuser's side: the storey's room, the bomb lying on the workbench until it is picked up. */
function DefuserRoom({ game, islandId, bomb, timeLeft, ready }: DefuserRoomProps) {
  const [lifted, setLifted] = useState(false)
  const { focused, back } = bomb
  const lift = useCallback(() => setLifted(true), [])

  // A module to work on is opened for the defuser: the bomb comes off the table with it.
  useEffect(() => {
    if (focused !== null) setLifted(true)
  }, [focused])

  // Esc: close the open module first, then put the bomb back on the table.
  useEffect(() => {
    if (!lifted) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (focused !== null) back()
      else setLifted(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lifted, focused, back])

  const house = useIslandHouse(islandId ?? '', game.topics[0] ?? '')
  const placed = house.status === 'ready' ? house.placed : null
  const storey = placed?.house.storeys.find((entry) => entry.id === game.skill_id) ?? placed?.house.storeys[0]

  const props: Omit<BombRoomProps, 'room' | 'wallSurface'> = {
    lifted,
    onLift: lift,
    onPutDown: () => setLifted(false),
    modules: bomb.bombModules,
    focused,
    onSelect: bomb.select,
    onBack: back,
    timeLeft,
    strikes: game.strikes,
    exploded: game.status === 'lost',
  }

  return (
    <>
      {placed && storey ? (
        <Suspense fallback={null}>
          <StoreyBombRoom house={placed.house} storey={storey} {...props} />
        </Suspense>
      ) : (
        <BombRoom room={PLAIN_ROOM} {...props} />
      )}
      <div className="room-bomb-ui">
        {focused !== null && bomb.card && (
          <div className={`bomb-zoom is-${bomb.focusedOnBomb ? 'side' : 'center'}`}>
            <div className="bomb-zoom-panel">{bomb.card}</div>
          </div>
        )}
        {ready && <div className="session-ready">{ready}</div>}
      </div>
    </>
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

type ExpertBriefing = Extract<Briefing, { role: 'expert' }>

/** One expert briefing as a page of the manual book. */
function toManual(briefing: ExpertBriefing): Manual {
  const { instruction, symbols } = briefing
  const prompt = briefing.prompt ?? (typeof instruction.prompt === 'string' ? instruction.prompt : undefined)
  const hidden = symbols?.length ? SYMBOL_FIELD[briefing.question_type] : undefined
  const manual: Manual = {
    title: `Modul ${briefing.turn + 1} · ${QUESTION_TYPE_LABELS[briefing.question_type] ?? briefing.question_type}`,
    prompt,
    glyphs: symbols?.length ? symbols.map(({ glyph, text }) => ({ glyph, text: asText(text) })) : undefined,
    lists: [],
    notes: [],
  }
  for (const [key, value] of Object.entries(instruction)) {
    if (key === 'prompt' || key === hidden) continue
    if (key === 'statements' && Array.isArray(value)) manual.statements = value.map(asText)
    else if (Array.isArray(value)) manual.lists!.push({ title: LIST_LABELS[key] ?? key, items: value.map(asText) })
    else manual.notes!.push(asText(value))
  }
  return manual
}

/**
 * The expert's side: the manual book. The server hands out one page per turn, so the book collects
 * them as the game goes on. It starts closed; once opened, it turns to the current module.
 */
function ExpertBook({ game, briefing }: { game: NonNullable<SessionState['game']>; briefing: ExpertBriefing | null }) {
  const [pages, setPages] = useState<Map<number, Manual>>(new Map())
  if (briefing && !pages.has(briefing.turn)) setPages(new Map(pages).set(briefing.turn, toManual(briefing)))

  const turns = [...pages.keys()].sort((a, b) => a - b)
  const current = briefing ? turns.indexOf(briefing.turn) : -1
  return (
    <ManualBook
      manuals={turns.map((turn) => pages.get(turn)!)}
      seed={seedOf(game.game_id)}
      ordered
      open={current === -1 ? undefined : current}
    />
  )
}

/** A stable number from the game id (for the book's paper details). */
const seedOf = (id: string) => [...id].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7) % 100000
