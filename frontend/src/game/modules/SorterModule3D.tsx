import { useRef, useState } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import type * as THREE from 'three'
import { FACE, FONT_URL, HINT_COLOR, labelSize } from './module3d'
import type { ModuleProps } from './types'

const ACTIVE = '#ffb547'
const PLATE_WIDTH = 0.86
const BELT_Y = 0.22
const CHUTE_Y = 0.1
const BIN_TOP = 0.055
const BIN_BOTTOM = -0.345
const CHIP_HEIGHT = 0.05

function stop(handler: () => void, enabled: boolean) {
  return (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (enabled) handler()
  }
}

/** Sorted part lying in a bin; it drops in from the chute when it arrives. Click to take it back. */
function Chip({ label, y, width, enabled, onTakeBack }: { label: string; y: number; width: number; enabled: boolean; onTakeBack: () => void }) {
  const ref = useRef<THREE.Group>(null)
  const [hover, setHover] = useState(false)
  useFrame((_, delta) => {
    if (ref.current) ref.current.position.y += (y - ref.current.position.y) * (1 - Math.exp(-delta * 14))
  })
  return (
    <group ref={ref} position={[0, CHUTE_Y, 0]}>
      <mesh
        position={[0, 0, 0.03]}
        onClick={stop(onTakeBack, enabled)}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHover(true)
        }}
        onPointerOut={() => setHover(false)}
      >
        <boxGeometry args={[width, CHIP_HEIGHT * 0.86, 0.03]} />
        <meshStandardMaterial color={hover && enabled ? '#d9a35a' : '#b9853f'} roughness={0.7} />
      </mesh>
      <Text
        font={FONT_URL}
        position={[0, 0, 0.046]}
        raycast={() => null}
        fontSize={labelSize(label, width * 0.92, CHIP_HEIGHT * 1.3, 0.026)}
        maxWidth={width * 0.92}
        anchorX="center"
        anchorY="middle"
        textAlign="center"
        color="#1b1408"
      >
        {label}
      </Text>
    </group>
  )
}

/**
 * Conveyor with a sorting gate on the bomb: the part on the belt goes into the bin whose chute you
 * click. Parts in a bin can be clicked to put them back on the belt.
 */
export default function SorterModule3D({ primitive, value, onChange, disabled }: ModuleProps<'assign'>) {
  const current = value.findIndex((v) => v === null)
  const remaining = value.filter((v) => v === null).length
  const binCount = primitive.targets.length
  const binWidth = PLATE_WIDTH / binCount
  const chipWidth = binWidth * 0.84

  function sort(target: number) {
    if (current === -1) return
    onChange(value.map((v, i) => (i === current ? target : v)))
  }

  function takeBack(item: number) {
    onChange(value.map((v, i) => (i === item ? null : v)))
  }

  return (
    <group>
      <Text font={FONT_URL} position={[-0.44, 0.37, FACE + 0.012]} fontSize={0.032} maxWidth={0.72} anchorX="left" anchorY="middle" color={HINT_COLOR}>
        Klick die Rutsche, in die das Teil vom Band soll.
      </Text>

      {/* conveyor belt with the current part */}
      <group position={[0, BELT_Y, FACE]}>
        <mesh position={[0, 0, 0.01]}>
          <boxGeometry args={[PLATE_WIDTH, 0.09, 0.02]} />
          <meshStandardMaterial color="#1b1e23" roughness={0.9} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * (PLATE_WIDTH / 2 - 0.02), 0, 0.012]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.05, 0.05, 0.04, 20]} />
            <meshStandardMaterial color="#8d939b" metalness={0.85} roughness={0.3} />
          </mesh>
        ))}
        {current === -1 ? (
          <Text font={FONT_URL} position={[0, 0, 0.024]} fontSize={0.032} anchorX="center" anchorY="middle" color="#3dff6e">
            Band leer ✓
          </Text>
        ) : (
          <group key={current}>
            <mesh position={[0, 0, 0.04]}>
              <boxGeometry args={[0.42, 0.072, 0.04]} />
              <meshStandardMaterial color="#c99447" roughness={0.7} />
            </mesh>
            <Text
              font={FONT_URL}
              position={[0, 0, 0.061]}
              fontSize={labelSize(primitive.items[current], 0.4, 0.09, 0.034)}
              maxWidth={0.4}
              anchorX="center"
              anchorY="middle"
              textAlign="center"
              color="#1b1408"
            >
              {primitive.items[current]}
            </Text>
          </group>
        )}
        <Text font={FONT_URL} position={[PLATE_WIDTH / 2 - 0.06, 0, 0.024]} fontSize={0.024} anchorX="right" anchorY="middle" color="#9aa3b2">
          {remaining} übrig
        </Text>
      </group>

      {primitive.targets.map((target, t) => {
        const x = -PLATE_WIDTH / 2 + binWidth * (t + 0.5)
        const canSort = !disabled && current !== -1
        const inBin = value.flatMap((v, i) => (v === t ? [i] : []))
        return (
          <group key={t} position={[x, 0, FACE]}>
            {/* chute: the gate you click */}
            <mesh position={[0, CHUTE_Y, 0.02]} onClick={stop(() => sort(t), canSort)}>
              <boxGeometry args={[binWidth * 0.9, 0.06, 0.04]} />
              <meshStandardMaterial color={canSort ? '#3a4150' : '#262a31'} metalness={0.4} roughness={0.5} />
            </mesh>
            <Text
              font={FONT_URL}
              position={[0, CHUTE_Y, 0.041]}
              raycast={() => null}
              fontSize={labelSize(`↓ ${target}`, binWidth * 0.82, 0.07, 0.03)}
              maxWidth={binWidth * 0.82}
              anchorX="center"
              anchorY="middle"
              textAlign="center"
              color={canSort ? ACTIVE : '#7d8590'}
            >
              ↓ {target}
            </Text>
            {/* the bin: dark back with low walls */}
            <mesh position={[0, (BIN_TOP + BIN_BOTTOM) / 2, 0.004]}>
              <boxGeometry args={[binWidth * 0.9, BIN_TOP - BIN_BOTTOM, 0.008]} />
              <meshStandardMaterial color="#0d1014" roughness={0.9} />
            </mesh>
            {[-1, 1].map((side) => (
              <mesh key={side} position={[(side * binWidth * 0.9) / 2, (BIN_TOP + BIN_BOTTOM) / 2, 0.025]}>
                <boxGeometry args={[0.012, BIN_TOP - BIN_BOTTOM, 0.05]} />
                <meshStandardMaterial color="#5b6270" metalness={0.6} roughness={0.4} />
              </mesh>
            ))}
            <mesh position={[0, BIN_BOTTOM, 0.025]}>
              <boxGeometry args={[binWidth * 0.9 + 0.012, 0.012, 0.05]} />
              <meshStandardMaterial color="#5b6270" metalness={0.6} roughness={0.4} />
            </mesh>
            {inBin.map((item, k) => (
              <Chip
                key={item}
                label={primitive.items[item]}
                y={BIN_BOTTOM + 0.012 + CHIP_HEIGHT * (k + 0.5)}
                width={chipWidth}
                enabled={!disabled}
                onTakeBack={() => takeBack(item)}
              />
            ))}
          </group>
        )
      })}
    </group>
  )
}
