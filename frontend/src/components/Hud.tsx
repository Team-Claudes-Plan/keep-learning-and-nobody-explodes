import type { ReactNode } from 'react'

type HudProps = {
  title: string
  /** Low-poly panel (cut corners, dark outline, hard shadow) like the islands dialogs. */
  lowPoly?: boolean
  children?: ReactNode
}

export default function Hud({ title, lowPoly = false, children }: HudProps) {
  const content = (
    <>
      <div className="hud-title">{title}</div>
      {children}
    </>
  )
  if (!lowPoly) return <div className="hud">{content}</div>
  // clip-path cuts off borders and shadows: the outline is a dark outer layer
  // and the shadow sits on the unclipped wrapper.
  return (
    <div className="hud hud-lowpoly">
      <div className="hud-lowpoly-body chamfer">
        <div className="hud-lowpoly-face chamfer">{content}</div>
      </div>
    </div>
  )
}
