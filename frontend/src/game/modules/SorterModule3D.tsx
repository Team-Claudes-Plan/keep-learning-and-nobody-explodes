import { useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import type * as THREE from 'three'
import { FACE, FONT_URL, HINT_COLOR } from './module3d'
import type { ModuleProps } from './types'

const ACTIVE = '#ffb547'
const PLATE_WIDTH = 0.86
const BELT_Y = 0.22
const CHUTE_Y = 0.1
const BIN_TOP = 0.055
const BIN_BOTTOM = -0.345
/** Space between a part's text and the edge of its box. */
const CHIP_PADDING = 0.03
/** Average glyph width of the label font, as a share of the font size (with room for word wrapping). */
const GLYPH_WIDTH = 0.62

/**
 * Font size and line count so a label fits a box of the given width in at most `maxLines` lines;
 * the box then takes its height from that, so the text never runs out of it.
 */
function fitText(label: string, width: number, maxFont: number, maxLines: number) {
  const fontSize = Math.min(maxFont, (maxLines * width) / (Math.max(label.length, 1) * GLYPH_WIDTH))
  const lines = Math.max(1, Math.ceil((label.length * GLYPH_WIDTH * fontSize) / width))
  return { fontSize, lines, height: lines * fontSize * 1.2 }
}

function stop(handler: () => void, enabled: boolean) {
  return (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (enabled) handler()
  }
}

/** Sorted part lying in its bin; it drops in from the chute when it arrives and then stays put. */
function Chip({ label, y, width, height, fontSize }: { label: string; y: number; width: number; height: number; fontSize: number }) {
  const ref = useRef<THREE.Group>(null)
  useFrame((_, delta) => {
    if (ref.current) ref.current.position.y += (y - ref.current.position.y) * (1 - Math.exp(-delta * 14))
  })
  return (
    <group ref={ref} position={[0, CHUTE_Y, 0]}>
      <mesh position={[0, 0, 0.03]}>
        <boxGeometry args={[width, height - 0.006, 0.03]} />
        <meshStandardMaterial color="#b9853f" roughness={0.7} />
      </mesh>
      <Text
        font={FONT_URL}
        position={[0, 0, 0.046]}
        fontSize={fontSize}
        maxWidth={width - CHIP_PADDING}
        anchorX="center"
        anchorY="middle"
        textAlign="center"
        lineHeight={1.15}
        color="#1b1408"
      >
        {label}
      </Text>
    </group>
  )
}

/**
 * Conveyor with a sorting gate on the bomb: the part on the belt goes into the bin whose chute you
 * click. Sorted parts stay in their bin.
 */
export default function SorterModule3D({ primitive, value, onChange, disabled }: ModuleProps<'assign'>) {
  const current = value.findIndex((v) => v === null)
  const remaining = value.filter((v) => v === null).length
  const binCount = primitive.targets.length
  const binWidth = PLATE_WIDTH / binCount
  const chipWidth = binWidth * 0.84
  // the part on the belt: its crate grows with the text (up to the belt's length, then two lines)
  const crate = current === -1 ? null : fitText(primitive.items[current], 0.68, 0.034, 2)
  const crateWidth =
    crate && crate.lines === 1
      ? Math.max(0.22, primitive.items[current].length * GLYPH_WIDTH * crate.fontSize + 0.08)
      : 0.76

  function sort(target: number) {
    if (current === -1) return
    onChange(value.map((v, i) => (i === current ? target : v)))
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
              <boxGeometry args={[crateWidth, Math.max(0.072, crate!.height + 0.03), 0.04]} />
              <meshStandardMaterial color="#c99447" roughness={0.7} />
            </mesh>
            <Text
              font={FONT_URL}
              position={[0, 0, 0.061]}
              fontSize={crate!.fontSize}
              maxWidth={crateWidth - 0.06}
              lineHeight={1.15}
              anchorX="center"
              anchorY="middle"
              textAlign="center"
              color="#1b1408"
            >
              {primitive.items[current]}
            </Text>
          </group>
        )}
        {/* above the belt on the left (the status LED sits top right), so a long part never covers it */}
        <Text font={FONT_URL} position={[-PLATE_WIDTH / 2 + 0.01, 0.075, 0.012]} fontSize={0.024} anchorX="left" anchorY="bottom" color="#9aa3b2">
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
              fontSize={fitText(`↓ ${target}`, binWidth * 0.82, 0.03, 1).fontSize}
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
            {(() => {
              // stacked from the bottom up, each box as tall as its text needs
              let bottom = BIN_BOTTOM + 0.006
              return inBin.map((item) => {
                const label = primitive.items[item]
                const fit = fitText(label, chipWidth - CHIP_PADDING, 0.026, 3)
                const height = fit.height + 0.02
                const y = bottom + height / 2
                bottom += height
                return <Chip key={item} label={label} y={y} width={chipWidth} height={height} fontSize={fit.fontSize} />
              })
            })()}
          </group>
        )
      })}
    </group>
  )
}
