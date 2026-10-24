import type { Decor, HouseParts } from '../../data/houseParts'
import Door from './Door'
import Sign from './Sign'
import StoreyDecor from './StoreyDecor'

type StoreyWallDressingProps = {
  width: number
  height: number
  parts: HouseParts
  decor: Decor
  label: string
  glow: number
}

// Mounted on a storey's back inner wall, centred on the wall (origin at wall centre, +Z into the room).
export default function StoreyWallDressing({
  width,
  height,
  parts,
  decor,
  label,
  glow,
}: StoreyWallDressingProps) {
  // Width follows height so the door keeps a real door's 1:2 shape when the storey is short.
  const doorH = Math.min(1.0, height * 0.66)
  const doorW = Math.min(doorH * 0.5, width * 0.3)
  const doorX = -width / 2 + 0.16 + doorW / 2
  const doorY = -height / 2 + 0.02 + doorH / 2

  const signW = Math.min(0.62, width * 0.26)
  const signH = 0.2
  const signX = doorX + doorW / 2 + 0.12 + signW / 2
  const signY = doorY + doorH / 2 - signH / 2

  // Decor models stand on the floor; the widest (bench) is 0.5 m, so keep clear of the side wall.
  const decorX = width / 2 - 0.42
  const decorY = -height / 2

  return (
    <group>
      <group position={[doorX, doorY, 0]}>
        <Door width={doorW} height={doorH} color={parts.door} frameColor={parts.edge} glow={glow} />
      </group>

      <group position={[signX, signY, 0]}>
        <Sign label={label} width={signW} height={signH} glow={glow} />
      </group>

      <group position={[decorX, decorY, 0]}>
        <StoreyDecor kind={decor.kind} color={decor.color} glow={glow} />
      </group>
    </group>
  )
}
