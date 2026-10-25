import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

export type SessionOutcome = 'won' | 'lost' | 'abandoned'

type Target = { to: string; label: string }

type SessionEndProps = {
  outcome: SessionOutcome
  /** Why the game ended, e.g. "Drei Fehler." */
  reason?: string
  /** An extra line, e.g. that the next storey is free now. */
  note?: string
  primary: Target
  secondary?: Target
}

const TITLES: Record<SessionOutcome, string> = {
  won: '✅ Entschärft',
  lost: '💥 BOOM',
  abandoned: '🏳️ Abgebrochen',
}

/** End of a koop game: a low-poly dialog in the middle of the screen, like the islands' dialogs. */
export default function SessionEnd({ outcome, reason, note, primary, secondary }: SessionEndProps) {
  const titleId = useId()
  const navigate = useNavigate()
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => first.current?.focus(), [])

  return (
    <div className={`upload-backdrop session-end-backdrop is-${outcome}`}>
      <div className="upload-dialog welcome-dialog session-end chamfer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="upload-dialog-face chamfer">
          <div className="welcome-banner chamfer">
            <div className="welcome-banner-face session-end-banner chamfer">
              <div id={titleId} className="welcome-banner-title">
                {TITLES[outcome]}
              </div>
              {reason && <div className="welcome-banner-subtitle">{reason}</div>}
            </div>
          </div>
          {note && <div className="welcome-lead">{note}</div>}
          <div className="session-end-actions">
            <button ref={first} type="button" className="is-primary" onClick={() => navigate(primary.to)}>
              {primary.label}
            </button>
            {secondary && (
              <button type="button" onClick={() => navigate(secondary.to)}>
                {secondary.label}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** How long the end screen waits, so the explosion or the party can be watched first. */
const WON_DELAY_MS = 3500
/** After the blast: the fireball needs about this long. */
const AFTER_BLAST_MS = 2600
/** The blast never came (e.g. the bomb model did not load): show the end screen anyway. */
const LOST_FALLBACK_MS = 5000

/** Whether the end screen is up yet: right away when abandoned, after the blast or the party otherwise. */
export function useEndScreen(outcome: SessionOutcome | null, blasted: boolean) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!outcome || shown) return
    const delay = outcome === 'won' ? WON_DELAY_MS : outcome === 'lost' ? (blasted ? AFTER_BLAST_MS : LOST_FALLBACK_MS) : 0
    const id = setTimeout(() => setShown(true), delay)
    return () => clearTimeout(id)
  }, [outcome, blasted, shown])
  return shown
}
