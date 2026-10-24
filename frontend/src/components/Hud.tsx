import type { ReactNode } from 'react'

type HudProps = {
  title: string
  children?: ReactNode
}

export default function Hud({ title, children }: HudProps) {
  return (
    <div className="hud">
      <div className="hud-title">{title}</div>
      {children}
    </div>
  )
}
