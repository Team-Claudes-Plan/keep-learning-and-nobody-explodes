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

  // deep green with white text when it can be pressed, dark grey when not (both clearly legible)
  const color = enabled ? (hover ? '#228a4a' : '#1b7a3f') : '#2a2f37'

  return (
    <group position={[0.27, -0.405, FACE]}>
      <mesh position={[0, 0, 0.006]}>
        <boxGeometry args={[0.27, 0.075, 0.012]} />
        <meshStandardMaterial color="#14171c" roughness={0.6} />
      </mesh>
      {/* click target just in front of the module's controls (slider blocks, cable plugs), so nothing
          reaching down into the bottom strip swallows a press. Not further out: seen in perspective it
          would drift off the button towards the edge of the screen. */}
      <mesh
        position={[0, 0, 0.07]}
        onClick={press}
        onPointerOver={() => setHover(true)}
        onPointerOut={() => setHover(false)}
      >
        <planeGeometry args={[0.29, 0.09]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <group ref={cap}>
        <mesh position={[0, 0, 0.022]} raycast={() => null}>
          <boxGeometry args={[0.25, 0.058, 0.024]} />
          {/* unlit, so the green never washes out to pastel under the room light: white text stays legible */}
          <meshBasicMaterial color={color} />
        </mesh>
        <Text
          font={FONT_URL}
          position={[0, 0, 0.0345]}
          raycast={() => null}
          fontSize={0.026}
          anchorX="center"
          anchorY="middle"
          color={enabled ? '#ffffff' : '#8b939f'}
        >
          {label}
        </Text>
      </group>
    </group>
  )
}
