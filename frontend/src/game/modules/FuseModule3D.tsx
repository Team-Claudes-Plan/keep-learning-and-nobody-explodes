import { useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import type * as THREE from 'three'
import { FACE, FONT_URL, labelSize, ROWS_BOTTOM, ROWS_TOP } from './module3d'
import { Label, ModuleHeading } from './Label3D'
import type { ModuleProps } from './types'

const ACTIVE = '#ffb547'
const PLATE_WIDTH = 0.86

type FuseProps = {
  x: number
  /** Top edge of the fuse's cell. */
  top: number
  width: number
  holderHeight: number
  label: string
  inserted: boolean
  stateLabel: string
  disabled: boolean
  onToggle: () => void
}

/** One fuse holder: click to push the glass fuse into its clips or pull it out again. */
function Fuse({ x, top, width, holderHeight, label, inserted, stateLabel, disabled, onToggle }: FuseProps) {
  const fuse = useRef<THREE.Group>(null)
  const holderY = top - 0.045 - holderHeight / 2
  const fuseLength = holderHeight * 0.62

  // Seated: flush in the clips. Pulled: sticks out towards the viewer, slightly tilted.
  useFrame((_, delta) => {
    const g = fuse.current
    if (!g) return
    const k = 1 - Math.exp(-delta * 16)
    g.position.z += ((inserted ? 0.038 : 0.1) - g.position.z) * k
    g.rotation.x += ((inserted ? 0 : -0.35) - g.rotation.x) * k
  })

  function click(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation()
    if (!disabled) onToggle()
  }

  // The whole holder reacts: the glass fuse (wherever it sticks out), clips, labels and the space
  // around them all toggle it.
  return (
    <group position={[x, 0, FACE]} onClick={click}>
      <Text
        font={FONT_URL}
        position={[0, top - 0.012, 0.012]}
        fontSize={0.026}
        anchorX="center"
        anchorY="top"
        color={inserted ? ACTIVE : '#a3abb7'}
      >
        {stateLabel}
      </Text>

      {/* holder with two spring clips */}
      <mesh position={[0, holderY, 0.012]}>
        <boxGeometry args={[Math.min(0.09, width * 0.5), holderHeight, 0.024]} />
        <meshStandardMaterial color="#1a1d22" roughness={0.7} />
      </mesh>
      {[1, -1].map((side) => (
        <mesh key={side} position={[0, holderY + (side * fuseLength) / 2, 0.034]}>
          <boxGeometry args={[0.05, 0.022, 0.02]} />
          <meshStandardMaterial color="#b9bec6" metalness={0.9} roughness={0.3} />
        </mesh>
      ))}

      {/* the fuse: glass body with a filament that glows once seated, metal caps at both ends */}
      <group position={[0, holderY, 0.038]} ref={fuse}>
        <mesh>
          <cylinderGeometry args={[0.02, 0.02, fuseLength * 0.8, 20]} />
          <meshStandardMaterial color="#d9e6f2" transparent opacity={0.35} roughness={0.1} metalness={0.1} />
        </mesh>
        <mesh>
          <cylinderGeometry args={[0.003, 0.003, fuseLength * 0.8, 6]} />
          <meshStandardMaterial
            color={inserted ? ACTIVE : '#6b6f75'}
            emissive={inserted ? ACTIVE : '#000000'}
            emissiveIntensity={inserted ? 1.4 : 0}
            toneMapped={!inserted}
          />
        </mesh>
        {[1, -1].map((side) => (
          <mesh key={side} position={[0, (side * fuseLength) / 2, 0]}>
            <cylinderGeometry args={[0.023, 0.023, fuseLength * 0.2, 20]} />
            <meshStandardMaterial color="#c9ced6" metalness={0.9} roughness={0.25} />
          </mesh>
        ))}
      </group>

      <Label
        font={FONT_URL}
        position={[0, holderY - holderHeight / 2 - 0.018, 0.012]}
        fontSize={labelSize(label, width * 0.92, 0.09, 0.034)}
        maxWidth={width * 0.92}
        anchorX="center"
        anchorY="top"
        textAlign="center"
        lineHeight={1.1}
        color={inserted ? '#f2f4f7' : '#aab1bb'}
      >
        {label}
      </Label>

      {/* invisible plane just in front of the dark backing, so clicks into the empty part of the cell count too */}
      <mesh position={[0, top - (holderHeight + 0.14) / 2, 0.0075]}>
        <planeGeometry args={[width * 0.94, holderHeight + 0.14]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}

/** Fuse box on the bomb: one holder per answer, click to insert or pull a fuse. */
export default function FuseModule3D({ primitive, value, onChange, disabled, heading }: ModuleProps<'pick'>) {
  const on = primitive.onLabel ?? 'EIN'
  const off = primitive.offLabel ?? 'AUS'
  const count = primitive.items.length
  const rows = count > 4 ? 2 : 1
  const cols = Math.ceil(count / rows)
  const width = PLATE_WIDTH / cols
  const rowHeight = Math.min(0.42, (ROWS_TOP - ROWS_BOTTOM) / rows)
  const holderHeight = Math.min(0.24, rowHeight - 0.13)
  const firstTop = (ROWS_TOP + ROWS_BOTTOM) / 2 + (rowHeight * rows) / 2

  function toggle(i: number) {
    if (value.includes(i)) onChange(value.filter((v) => v !== i))
    else onChange(primitive.mode === 'one' ? [i] : [...value, i])
  }

  return (
    <group>
      <ModuleHeading text={heading} />
      {/* dark backing behind the holders */}
      <mesh position={[0, (ROWS_TOP + ROWS_BOTTOM) / 2, FACE + 0.003]}>
        <boxGeometry args={[PLATE_WIDTH + 0.02, ROWS_TOP - ROWS_BOTTOM + 0.04, 0.006]} />
        <meshStandardMaterial color="#0d1014" roughness={0.8} />
      </mesh>
      {primitive.items.map((label, i) => {
        const row = Math.floor(i / cols)
        const inRow = row === rows - 1 ? count - cols * (rows - 1) : cols
        const col = i - row * cols
        return (
          <Fuse
            key={i}
            x={(col - (inRow - 1) / 2) * width}
            top={firstTop - row * rowHeight}
            width={width}
            holderHeight={holderHeight}
            label={label}
            inserted={value.includes(i)}
            stateLabel={value.includes(i) ? on : off}
            disabled={disabled}
            onToggle={() => toggle(i)}
          />
        )
      })}
    </group>
  )
}
