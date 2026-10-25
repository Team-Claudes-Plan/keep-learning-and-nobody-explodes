import { useEffect, useRef, useState } from 'react'
import { useSession, type SessionClient } from '../../api/session'
import ReadyButton3D from './ReadyButton3D'

type ReadyViewProps = {
  partnerName: string
  meReady: boolean
  partnerReady: boolean
  /** Not pressable yet; `note` says why. */
  disabled?: boolean
  note?: string
  onPress: () => void
}

/** The "Bereit" button before a game, with who is ready so far. */
function ReadyView({ partnerName, meReady, partnerReady, disabled = false, note, onPress }: ReadyViewProps) {
  return (
    <div className="ready-check">
      <ReadyButton3D pressed={meReady} disabled={disabled} onPress={onPress} />
      <ul className="ready-check-players">
        <li className={meReady ? 'is-ready' : ''}>
          <span className="ready-check-mark" aria-hidden>{meReady ? '✓' : '…'}</span> Du
        </li>
        <li className={partnerReady ? 'is-ready' : ''}>
          <span className="ready-check-mark" aria-hidden>{partnerReady ? '✓' : '…'}</span> {partnerName}
        </li>
      </ul>
      <small>
        {note ??
          (meReady
            ? partnerReady
              ? 'Los geht’s!'
              : `Warte auf ${partnerName}…`
            : 'Drück auf Bereit, sobald du loslegen willst. Die Bombe startet, wenn ihr beide bereit seid.')}
      </small>
    </div>
  )
}

/** Ready check over the game socket: sends `ready`; the server starts the game once both sent it. */
export function SessionReadyCheck({ client, partnerName }: { client: SessionClient; partnerName: string }) {
  const { game, playerId, connection } = useSession(client)
  const [sent, setSent] = useState(false)
  const me = game?.players.find((player) => player.player_id === playerId)
  const partner = game?.players.find((player) => player.player_id !== playerId)
  const status = game?.status
  const canPress = status === 'ready' && connection === 'open'
  const note =
    connection === 'reconnecting'
      ? 'Verbindung weg, verbinde neu…'
      : !game || connection === 'connecting'
        ? 'Verbinde mit dem Spiel…'
        : status === 'waiting'
          ? `Warte, bis ${partnerName} am Tisch sitzt…`
          : undefined
  return (
    <ReadyView
      partnerName={partnerName}
      meReady={Boolean(me?.ready) || sent}
      partnerReady={Boolean(partner?.ready)}
      disabled={!canPress}
      note={note}
      onPress={() => setSent(client.ready())}
    />
  )
}

const MOCK_PARTNER_READY_MS = 1200
const MOCK_START_MS = 600

/** Without a backend the partner is played: ready a moment after me, then the game starts. */
export function MockReadyCheck({ partnerName, onStart }: { partnerName: string; onStart: () => void }) {
  const [meReady, setMeReady] = useState(false)
  const [partnerReady, setPartnerReady] = useState(false)
  const start = useRef(onStart)
  useEffect(() => {
    start.current = onStart
  }, [onStart])
  useEffect(() => {
    if (!meReady) return
    const ready = window.setTimeout(() => setPartnerReady(true), MOCK_PARTNER_READY_MS)
    const go = window.setTimeout(() => start.current(), MOCK_PARTNER_READY_MS + MOCK_START_MS)
    return () => {
      window.clearTimeout(ready)
      window.clearTimeout(go)
    }
  }, [meReady])
  return (
    <ReadyView partnerName={partnerName} meReady={meReady} partnerReady={partnerReady} onPress={() => setMeReady(true)} />
  )
}
