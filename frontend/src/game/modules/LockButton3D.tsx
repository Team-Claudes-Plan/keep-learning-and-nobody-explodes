import { useRef, useState } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import type * as THREE from 'three'
import { FACE, FONT_URL } from './module3d'

type Props = {
  /** Answer complete and module still active. */
  enabled: boolean
  label: string
  onPress: () => void
}

/** Physical "Abschließen" push button in the bottom strip of a 3D module. */
export default function LockButton3D({ enabled, label, onPress }: Props) {
  const cap = useRef<THREE.Group>(null)
  const [hover, setHover] = useState(false)
  const pressed = useRef(false)
  const pressedAt = useRef(-1)

  // Sinks in briefly when pressed.
  useFrame(({ clock }) => {
    if (!cap.current) return
    if (pressed.current) {
      pressed.current = false
      pressedAt.current = clock.elapsedTime
    }
    cap.current.position.z = clock.elapsedTime - pressedAt.current < 0.18 ? -0.012 : 0
  })

  function press(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation()
    if (!enabled) return
    pressed.current = true
    onPress()
  }

  const color = enabled ? (hover ? '#3bbf68' : '#2f9e55') : '#5b6270'

  return (
    <group position={[0.27, -0.405, FACE]}>
      <mesh position={[0, 0, 0.006]}>
        <boxGeometry args={[0.27, 0.075, 0.012]} />
        <meshStandardMaterial color="#14171c" roughness={0.6} />
      </mesh>
      <group ref={cap}>
        <mesh
          position={[0, 0, 0.022]}
          onClick={press}
          onPointerOver={() => setHover(true)}
          onPointerOut={() => setHover(false)}
        >
          <boxGeometry args={[0.25, 0.058, 0.024]} />
          <meshStandardMaterial color={color} roughness={0.4} emissive={color} emissiveIntensity={enabled ? 0.25 : 0} />
        </mesh>
        <Text
          font={FONT_URL}
          position={[0, 0, 0.0345]}
          raycast={() => null}
          fontSize={0.026}
          anchorX="center"
          anchorY="middle"
          color={enabled ? '#ffffff' : '#c3c9d3'}
        >
          {label}
        </Text>
      </group>
    </group>
  )
}
