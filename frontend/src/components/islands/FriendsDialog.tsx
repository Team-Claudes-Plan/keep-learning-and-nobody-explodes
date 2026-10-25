import { useEffect, useId, useState } from 'react'
import type { Island, UserSummary } from '../../api/types'
import { IslandPartner } from './IslandActions'

// Pixel-art pair of friends. # outline, s skin, b front shirt, c back shirt.
const ICON_PIXELS = [
  '................',
  '.........###....',
  '........#sss#...',
  '...###..#sss#...',
  '..#sss#.#sss#...',
  '..#sss#..###....',
  '..#sss#.#ccc#...',
  '...###.#ccccc#..',
  '..#bbb##ccccc#..',
  '.#bbbbb#ccccc#..',
  '.#bbbbb#ccccc#..',
  '.#bbbbb#######..',
  '.#bbbbb#........',
  '.#######........',
  '................',
  '................',
]

const ICON_COLORS: Record<string, string> = {
  '#': '#1b1030',
  s: '#ffd9b0',
  b: 'currentColor',
  c: '#ffffff',
}

// One rect per horizontal run of the same colour.
const ICON_RECTS = ICON_PIXELS.flatMap((row, y) => {
  const runs: { x: number; y: number; width: number; fill: string }[] = []
  for (let x = 0; x < row.length; ) {
    const char = row[x]
    let end = x
    while (row[end] === char) end++
    if (ICON_COLORS[char]) runs.push({ x, y, width: end - x, fill: ICON_COLORS[char] })
    x = end
  }
  return runs
})

/** Friends icon: two pixel-art people side by side. */
export function FriendsIcon({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {ICON_RECTS.map((rect) => (
        <rect key={`${rect.x}-${rect.y}`} x={rect.x} y={rect.y} width={rect.width} height={1} fill={rect.fill} />
      ))}
    </svg>
  )
}

type FriendsDialogProps = {
  island: Island
  me: UserSummary
  onForked: (islandId: string) => void
  onClose: () => void
}

/** Invite a friend to the current island, and share your own id so friends can add you. */
export default function FriendsDialog({ island, me, onForked, onClose }: FriendsDialogProps) {
  const titleId = useId()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const copy = () => {
    void navigator.clipboard?.writeText(me.id).then(() => setCopied(true))
  }

  return (
    <div className="upload-backdrop" onClick={onClose}>
      <div
        className="upload-dialog friends-dialog chamfer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="upload-dialog-face chamfer">
          <div className="upload-header">
            <div>
              <div id={titleId} className="upload-title">
                Invite friends
              </div>
              <div className="upload-subtitle">to {island.name}</div>
            </div>
            <button type="button" className="upload-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>

          <div className="friends-section">
            <div className="friends-section-title">Add a friend</div>
            <div className="hud-note">Your friend finds their user id in this dialog, under "Your id".</div>
            <IslandPartner
              island={island}
              onForked={(id) => {
                onForked(id)
                onClose()
              }}
              inline
            />
          </div>

          <div className="friends-section">
            <div className="friends-section-title">Your id</div>
            <div className="hud-note">Send it to a friend so they can add you to their island.</div>
            <div className="friends-id-row">
              <code className="friends-id">{me.id}</code>
              <button type="button" onClick={copy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="upload-actions">
            <button type="button" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
