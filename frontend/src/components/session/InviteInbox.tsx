import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { USES_BACKEND } from '../../api/client'
import { answerInvite, useUserChannel, type Invite } from '../../api/invites'
import { acquireSession, isOver, releaseSession, type SessionClient } from '../../api/session'
import { useIslandHouse } from '../../data/useIslandHouse'
import { sessionErrorText } from '../../game/sessionErrors'
import { gamePath } from '../../game/useInviteFlow'
import { MockReadyCheck, SessionReadyCheck } from './ReadyCheck'

/**
 * Game invites to me, on every page. Accepting joins the game and shows the "Bereit" button; once
 * both players are ready I go to the game as the expert.
 */
export default function InviteInbox() {
  const { incoming } = useUserChannel()
  const [accepted, setAccepted] = useState<Invite | null>(null)
  if (accepted) return <ReadyCard key={accepted.id} invite={accepted} onClose={() => setAccepted(null)} />
  const invite = incoming[0]
  if (!invite) return null
  return (
    <InviteCard
      key={invite.id}
      invite={invite}
      more={incoming.length - 1}
      onAccept={() => {
        answerInvite(invite.id, true)
        setAccepted(invite)
      }}
    />
  )
}

/** Where the invite plays, e.g. "Mathe · Erdgeschoss". */
function useWhere(invite: Invite) {
  const house = useIslandHouse(invite.islandId, invite.topicId)
  const placed = house.status === 'ready' ? house.placed : null
  const storey = placed?.house.storeys.find((entry) => entry.id === invite.storeyId)
  return [placed?.name, storey?.label].filter(Boolean).join(' · ')
}

function InviteCard({ invite, more, onAccept }: { invite: Invite; more: number; onAccept: () => void }) {
  const where = useWhere(invite)
  return (
    <aside className="invite-card" role="alertdialog" aria-labelledby={`invite-${invite.id}`}>
      <div className="session-alert-tape is-calm" aria-hidden />
      <div className="invite-card-body">
        <strong id={`invite-${invite.id}`}>📨 Einladung von {invite.from.name}</strong>
        <p>
          {invite.from.name} will mit dir eine Bombe entschärfen{where ? <> in <b>{where}</b></> : null}. Du fängst mit dem
          Handbuch an.
        </p>
        <div className="invite-card-buttons">
          <button className="session-chunky is-go" onClick={onAccept}>
            Annehmen
          </button>
          <button className="session-chunky is-grey" onClick={() => answerInvite(invite.id, false)}>
            Ablehnen
          </button>
        </div>
        {more > 0 && <small>+{more} weitere</small>}
      </div>
    </aside>
  )
}

/** After accepting: join the game and wait until both pressed "Bereit", then open the game page. */
function ReadyCard({ invite, onClose }: { invite: Invite; onClose: () => void }) {
  const navigate = useNavigate()
  const where = useWhere(invite)
  const [client, setClient] = useState<SessionClient | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const start = () => {
    onClose()
    navigate(gamePath(invite.gameId, 'expert', invite.islandId))
  }
  const startRef = useRef(start)
  useEffect(() => {
    startRef.current = start
  })

  useEffect(() => {
    if (!USES_BACKEND) return
    const next = acquireSession(invite.gameId, 'expert')
    setClient(next)
    let handedOver = false
    const check = () => {
      const { game, connection, error } = next.getState()
      if (game?.status === 'active') {
        handedOver = true
        stop()
        startRef.current()
      } else if (isOver(game)) {
        stop()
        setProblem(`${invite.from.name} hat die Session abgebrochen.`)
      } else if (connection === 'failed') {
        stop()
        setProblem(error ? sessionErrorText(error) : 'Keine Verbindung zum Spiel.')
      }
    }
    const stop = next.subscribe(check)
    check()
    return () => {
      stop()
      // On handover the game page takes the socket over; give it time to mount first.
      if (handedOver) window.setTimeout(() => releaseSession(next), 2000)
      else releaseSession(next)
    }
  }, [invite])

  const cancel = () => {
    if (client && !isOver(client.getState().game)) client.forfeit()
    onClose()
  }

  return (
    <aside className="invite-card" role="dialog" aria-labelledby={`ready-${invite.id}`}>
      <div className={`session-alert-tape ${problem ? '' : 'is-calm'}`} aria-hidden />
      <div className="invite-card-body">
        <strong id={`ready-${invite.id}`}>
          {problem ? '⚠️ Abgebrochen' : `💣 Mit ${invite.from.name}`}
          {!problem && where ? <> · {where}</> : null}
        </strong>
        {problem ? (
          <>
            <p>{problem}</p>
            <button className="session-chunky is-dark" onClick={onClose}>
              Verstanden
            </button>
          </>
        ) : (
          <>
            {client ? (
              <SessionReadyCheck client={client} partnerName={invite.from.name} />
            ) : USES_BACKEND ? null : (
              <MockReadyCheck partnerName={invite.from.name} onStart={start} />
            )}
            <button className="session-chunky is-grey" onClick={cancel}>
              Abbrechen
            </button>
          </>
        )}
      </div>
    </aside>
  )
}
