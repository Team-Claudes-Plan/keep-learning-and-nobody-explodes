import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { UserSummary } from '../../api/types'
import type { InviteFlow } from '../../game/useInviteFlow'

type SessionStartProps = {
  storeyLabel: string
  conceptLabel: string
  partner: UserSummary | null
  partnerOnline: boolean
  flow: InviteFlow
  onStart: () => void
  onCancel: () => void
  onClose: () => void
  /** The room's bomb to practise alone; only without a backend, where nothing is recorded. */
  soloPath?: string
}

/** The panel after clicking a room: start a session with the island partner and wait for them. */
export default function SessionStart({
  storeyLabel,
  conceptLabel,
  partner,
  partnerOnline,
  flow,
  onStart,
  onCancel,
  onClose,
  soloPath,
}: SessionStartProps) {
  const sent = useFlash(flow.step === 'waiting')

  return (
    <>
      {sent && (
        <div className="session-flash" role="status">
          📨 Einladung gesendet
        </div>
      )}

      <section className={`session-start is-${flow.step}`} aria-live="polite">
        <header className="session-start-head">
          <div>
            <div className="session-start-storey">{storeyLabel}</div>
            <div className="session-start-concept">{conceptLabel}</div>
          </div>
          {flow.step !== 'waiting' && (
            <button className="session-start-close" onClick={onClose} aria-label="Schließen">
              ✕
            </button>
          )}
        </header>

        {flow.step === 'error' ? (
          <div className="session-alert" role="alert">
            <div className="session-alert-tape" aria-hidden />
            <div className="session-alert-body">
              <strong>⚠️ {flow.title}</strong>
              <p>{flow.message}</p>
              <button className="session-chunky is-dark" onClick={onCancel}>
                Verstanden
              </button>
            </div>
          </div>
        ) : flow.step === 'waiting' ? (
          <div className="session-waiting">
            <div className="session-waiting-fuse" aria-hidden>
              <span />
            </div>
            <p>
              Warte auf <strong>{flow.partner.name}</strong>
              <span className="session-dots" aria-hidden>
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </span>
            </p>
            <small>
              Sobald {flow.partner.name} annimmt, geht es los: du fängst mit der Bombe an, {flow.partner.name} mit dem
              Handbuch. Danach wechselt ihr euch jede Runde ab.
            </small>
            <button className="session-chunky is-grey" onClick={onCancel}>
              Abbrechen
            </button>
          </div>
        ) : (
          <>
            <button className="session-chunky is-go" onClick={onStart} disabled={flow.step === 'starting'}>
              {flow.step === 'starting' ? 'Verbinde…' : '▶ Session starten'}
            </button>
            <p className="session-partner">
              {partner ? (
                <>
                  <span className={`session-dot ${partnerOnline ? 'is-online' : ''}`} aria-hidden />
                  mit {partner.name} · {partnerOnline ? 'online' : 'offline'}
                </>
              ) : (
                'Niemand sonst auf dieser Insel'
              )}
            </p>
          </>
        )}

        {flow.step !== 'waiting' && soloPath && (
          <Link className="session-solo" to={soloPath}>
            Allein üben →
          </Link>
        )}
      </section>
    </>
  )
}

/** True for a few seconds after `on` turns true. */
function useFlash(on: boolean, ms = 2500) {
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (!on) return
    setFlash(true)
    const timer = window.setTimeout(() => setFlash(false), ms)
    return () => window.clearTimeout(timer)
  }, [on, ms])
  return on && flash
}
