import { useRef, useState } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import type * as THREE from 'three'
import { FACE, FONT_URL, HINT_COLOR, labelSize, ROWS_BOTTOM, ROWS_TOP } from './module3d'
import type { ModuleProps } from './types'

const BUTTON_COLORS = ['#e5484d', '#3e63dd', '#eab308', '#30a46c', '#8e4ec6', '#f76b15', '#12a594', '#d6409f']
const PLATE_WIDTH = 0.86

type PushButtonProps = {
  x: number
  y: number
  radius: number
  width: number
  label: string
  color: string
  /** Position in the pressed order (0-based), or -1 if not pressed yet. */
  step: number
  disabled: boolean
  onPress: () => void
}

/** Big round push button: pressed ones stay down, light up and show their place in the order. */
function PushButton({ x, y, radius, width, label, color, step, disabled, onPress }: PushButtonProps) {
  const cap = useRef<THREE.Group>(null)
  const [hover, setHover] = useState(false)
  const pressed = step !== -1

  useFrame((_, delta) => {
    if (cap.current) cap.current.position.z += ((pressed ? 0.012 : 0.03) - cap.current.position.z) * (1 - Math.exp(-delta * 24))
  })

  function click(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation()
    if (!disabled) onPress()
  }

  return (
    <group position={[x, y, FACE]}>
      {/* metal bezel */}
      <mesh position={[0, 0, 0.008]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[radius * 1.18, radius * 1.22, 0.016, 40]} />
        <meshStandardMaterial color="#9aa0a6" metalness={0.9} roughness={0.3} />
      </mesh>
      <group ref={cap} position={[0, 0, 0.03]}>
        <mesh
          rotation={[Math.PI / 2, 0, 0]}
          onClick={click}
          onPointerOver={(e) => {
            e.stopPropagation()
            setHover(true)
          }}
          onPointerOut={() => setHover(false)}
        >
          <cylinderGeometry args={[radius * 0.92, radius, 0.04, 40]} />
          <meshStandardMaterial
            color={color}
            roughness={0.35}
            emissive={color}
            emissiveIntensity={pressed ? 0.9 : hover && !disabled ? 0.3 : 0.05}
          />
        </mesh>
        {pressed && (
          <Text font={FONT_URL} position={[0, 0, 0.021]} raycast={() => null} fontSize={radius * 0.9} anchorX="center" anchorY="middle" color="#ffffff">
            {String(step + 1)}
          </Text>
        )}
      </group>
      <Text
        font={FONT_URL}
        position={[0, -radius * 1.22 - 0.02, 0.012]}
        fontSize={labelSize(label, width * 0.92, 0.09, 0.032)}
        maxWidth={width * 0.92}
        anchorX="center"
        anchorY="top"
        textAlign="center"
        lineHeight={1.1}
        color="#f2f4f7"
      >
        {label}
      </Text>
    </group>
  )
}

/** Push-button panel on the bomb: press the buttons in the right order; pressing one again undoes from there. */
export default function ButtonsModule3D({ primitive, value, onChange, disabled }: ModuleProps<'sequence'>) {
  const count = primitive.items.length
  const rows = count > 4 ? 2 : 1
  const cols = Math.ceil(count / rows)
  const width = PLATE_WIDTH / cols
  const rowHeight = (ROWS_TOP - ROWS_BOTTOM) / rows
  const radius = Math.min(0.085, width * 0.3, rowHeight * 0.26)
  const center = (ROWS_TOP + ROWS_BOTTOM) / 2

  function press(i: number) {
    const at = value.indexOf(i)
    onChange(at === -1 ? [...value, i] : value.slice(0, at))
  }

  function reset(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation()
    if (!disabled && value.length > 0) onChange([])
  }

  const canReset = !disabled && value.length > 0

  return (
    <group>
      <Text font={FONT_URL} position={[-0.44, 0.37, FACE + 0.012]} fontSize={0.032} maxWidth={0.72} anchorX="left" anchorY="middle" color={HINT_COLOR}>
        Drück die Knöpfe in der richtigen Reihenfolge.
      </Text>
      {primitive.items.map((label, i) => {
        const row = Math.floor(i / cols)
        const inRow = row === rows - 1 ? count - cols * (rows - 1) : cols
        const col = i - row * cols
        // button a little above the middle of its row, the label below it
        const y = center + ((rows - 1) / 2 - row) * rowHeight + rowHeight * 0.1
        return (
          <PushButton
            key={i}
            x={(col - (inRow - 1) / 2) * width}
            y={y}
            radius={radius}
            width={width}
            label={label}
            color={BUTTON_COLORS[i % BUTTON_COLORS.length]}
            step={value.indexOf(i)}
            disabled={disabled}
            onPress={() => press(i)}
          />
        )
      })}

      {/* reset button in the bottom strip, left of the lock-in button */}
      <group position={[-0.3, -0.405, FACE]}>
        <mesh position={[0, 0, 0.006]}>
          <boxGeometry args={[0.2, 0.075, 0.012]} />
          <meshStandardMaterial color="#14171c" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0, 0.022]} onClick={reset}>
          <boxGeometry args={[0.18, 0.058, 0.024]} />
          <meshStandardMaterial color={canReset ? '#8d939b' : '#3a3f47'} metalness={0.5} roughness={0.4} />
        </mesh>
        <Text font={FONT_URL} position={[0, 0, 0.0345]} raycast={() => null} fontSize={0.024} anchorX="center" anchorY="middle" color={canReset ? '#14171c' : '#7d8590'}>
          RESET
        </Text>
      </group>
    </group>
  )
}
