import { useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import type * as THREE from 'three'
import { FONT_URL } from '../../game/modules/module3d'

const GREEN = '#2fbf68'
const SIDES = 8
const CAP_UP = 0.34
const CAP_DOWN = 0.16

/** The octagonal cap: bobs while it waits, sinks and glows once pressed. */
function Cap({ pressed, hover }: { pressed: boolean; hover: boolean }) {
  const cap = useRef<THREE.Group>(null)
  useFrame(({ clock }, delta) => {
    if (!cap.current) return
    const bob = pressed ? 0 : Math.sin(clock.elapsedTime * 3) * 0.025
    const target = (pressed ? CAP_DOWN : hover ? CAP_UP + 0.04 : CAP_UP) + bob
    cap.current.position.y += (target - cap.current.position.y) * (1 - Math.exp(-delta * 18))
  })
  return (
    <group ref={cap} position={[0, CAP_UP, 0]}>
      <mesh>
        <cylinderGeometry args={[0.92, 1, 0.3, SIDES]} />
        <meshStandardMaterial
          color={GREEN}
          flatShading
          roughness={0.55}
          emissive={GREEN}
          emissiveIntensity={pressed ? 0.6 : hover ? 0.3 : 0.12}
        />
      </mesh>
      <Text
        font={FONT_URL}
        position={[0, 0.152, 0.04]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.36}
        anchorX="center"
        anchorY="middle"
        color="#ffffff"
        outlineWidth={0.012}
        outlineColor="#167a40"
      >
        BEREIT
      </Text>
    </group>
  )
}

/** Dark octagonal housing the cap sits in. */
function Housing() {
  return (
    <>
      <mesh position={[0, 0.06, 0]}>
        <cylinderGeometry args={[1.22, 1.38, 0.24, SIDES]} />
        <meshStandardMaterial color="#2a2f38" flatShading roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.19, 0]}>
        <cylinderGeometry args={[1.06, 1.12, 0.06, SIDES]} />
        <meshStandardMaterial color="#14171c" flatShading roughness={0.9} />
      </mesh>
    </>
  )
}

/** Big green low-poly push button. A real <button> underneath, so it works with keyboard and tests. */
export default function ReadyButton3D({
  pressed,
  onPress,
  disabled = false,
}: {
  pressed: boolean
  onPress: () => void
  /** Not pressable yet, e.g. while the partner is still joining. */
  disabled?: boolean
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      type="button"
      className="session-ready-button"
      aria-label="Bereit"
      aria-pressed={pressed}
      disabled={pressed || disabled}
      onClick={onPress}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
    >
      <Canvas
        className="session-ready-canvas"
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true }}
        camera={{ position: [0, 2.6, 2.7], fov: 34 }}
        onCreated={({ camera }) => camera.lookAt(0, 0.15, 0)}
      >
        <ambientLight intensity={0.9} />
        <directionalLight position={[2.5, 5, 3]} intensity={2.2} />
        <directionalLight position={[-3, 2, -1]} intensity={0.5} color="#9fc4ff" />
        <Housing />
        <Cap pressed={pressed} hover={hover && !pressed && !disabled} />
      </Canvas>
    </button>
  )
}
