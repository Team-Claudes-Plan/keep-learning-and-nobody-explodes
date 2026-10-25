import { useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import type * as THREE from 'three'
import { FACE, FONT_URL, labelSize, ROWS_BOTTOM, ROWS_TOP } from './module3d'
import { Label, ModuleHeading } from './Label3D'
import type { ModuleProps } from './types'

const ACTIVE = '#ffb547'
const PLATE_WIDTH = 0.86

/** Smallest font a label may get side by side; anything smaller switches to one answer per row. */
const MIN_COLUMN_FONT = 0.026
/** Average glyph width of the label font, as a share of the font size. */
const GLYPH_WIDTH = 0.62

/**
 * Font size for a label in a box of the given size. The text wraps only between words, so the
 * longest word has to fit on a line by itself.
 */
function fitLabel(label: string, width: number, height: number, max: number) {
  const longestWord = Math.max(1, ...label.split(/\s+/).map((word) => word.length))
  return Math.min(labelSize(label, width, height, max), width / (longestWord * GLYPH_WIDTH))
}

type HolderProps = {
  holderHeight: number
  holderWidth: number
  inserted: boolean
}

/** Holder with two spring clips and the glass fuse, standing upright around the origin. */
function Holder({ holderHeight, holderWidth, inserted }: HolderProps) {
  const fuse = useRef<THREE.Group>(null)
  const fuseLength = holderHeight * 0.62

  // Seated: flush in the clips. Pulled: sticks out towards the viewer, slightly tilted.
  useFrame((_, delta) => {
    const g = fuse.current
    if (!g) return
    const k = 1 - Math.exp(-delta * 16)
    g.position.z += ((inserted ? 0.038 : 0.1) - g.position.z) * k
    g.rotation.x += ((inserted ? 0 : -0.35) - g.rotation.x) * k
  })

  return (
    <group>
      <mesh position={[0, 0, 0.012]}>
        <boxGeometry args={[holderWidth, holderHeight, 0.024]} />
        <meshStandardMaterial color="#1a1d22" roughness={0.7} />
      </mesh>
      {[1, -1].map((side) => (
        <mesh key={side} position={[0, (side * fuseLength) / 2, 0.034]}>
          <boxGeometry args={[0.05, 0.022, 0.02]} />
          <meshStandardMaterial color="#b9bec6" metalness={0.9} roughness={0.3} />
        </mesh>
      ))}

      {/* the fuse: glass body with a filament that glows once seated, metal caps at both ends */}
      <group position={[0, 0, 0.038]} ref={fuse}>
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
    </group>
  )
}

type FuseProps = {
  label: string
  inserted: boolean
  stateLabel: string
  disabled: boolean
  onToggle: () => void
}

function toggleOnClick({ disabled, onToggle }: Pick<FuseProps, 'disabled' | 'onToggle'>) {
  return (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (!disabled) onToggle()
  }
}

/**
 * One fuse in a column (answers side by side): state on top, the upright fuse below it, the answer
 * underneath. The whole cell toggles it.
 */
function ColumnFuse({
  x,
  top,
  width,
  holderHeight,
  label,
  inserted,
  stateLabel,
  ...click
}: FuseProps & { x: number; top: number; width: number; holderHeight: number }) {
  const holderY = top - 0.045 - holderHeight / 2
  return (
    <group position={[x, 0, FACE]} onClick={toggleOnClick(click)}>
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

      <group position={[0, holderY, 0]}>
        <Holder holderHeight={holderHeight} holderWidth={Math.min(0.09, width * 0.5)} inserted={inserted} />
      </group>

      <Label
        font={FONT_URL}
        position={[0, holderY - holderHeight / 2 - 0.018, 0.012]}
        fontSize={fitLabel(label, width * 0.92, 0.09, 0.034)}
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

const ROW_STATE_WIDTH = 0.07
const ROW_HOLDER_LENGTH = 0.17

/**
 * One fuse in a row (answers stacked, for long ones): state on the left, the fuse lying on its
 * side, then the answer with the rest of the row to itself. The whole row toggles it.
 */
function RowFuse({
  left,
  y,
  width,
  height,
  label,
  inserted,
  stateLabel,
  ...click
}: FuseProps & { left: number; y: number; width: number; height: number }) {
  // the holder is drawn for a 0.11 tall row and shrunk to fit lower ones
  const scale = Math.min(1, height / 0.11)
  const holderX = ROW_STATE_WIDTH + (ROW_HOLDER_LENGTH * scale) / 2
  const labelX = ROW_STATE_WIDTH + ROW_HOLDER_LENGTH * scale + 0.03
  const labelWidth = width - labelX - 0.015
  return (
    <group position={[left, y, FACE]} onClick={toggleOnClick(click)}>
      <Text
        font={FONT_URL}
        position={[0.012, 0, 0.012]}
        fontSize={0.024}
        anchorX="left"
        anchorY="middle"
        color={inserted ? ACTIVE : '#a3abb7'}
      >
        {stateLabel}
      </Text>

      <group position={[holderX, 0, 0]} rotation={[0, 0, Math.PI / 2]} scale={[scale, scale, 1]}>
        <Holder holderHeight={ROW_HOLDER_LENGTH} holderWidth={0.08} inserted={inserted} />
      </group>

      <Label
        font={FONT_URL}
        position={[labelX, 0, 0.012]}
        fontSize={fitLabel(label, labelWidth, height * 0.9, 0.034)}
        maxWidth={labelWidth}
        anchorX="left"
        anchorY="middle"
        textAlign="left"
        lineHeight={1.1}
        color={inserted ? '#f2f4f7' : '#aab1bb'}
      >
        {label}
      </Label>

      {/* invisible plane across the whole row, so clicks anywhere in it count */}
      <mesh position={[width / 2, 0, 0.0075]}>
        <planeGeometry args={[width, height * 0.96]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}

/**
 * Fuse box on the bomb: one holder per answer, click to insert or pull a fuse. Short answers stand
 * side by side; if any answer would not fit its column readably, they are stacked one per row.
 */
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
  const stacked = primitive.items.some((label) => fitLabel(label, width * 0.92, 0.09, 0.034) < MIN_COLUMN_FONT)

  // stacked: one answer per row, in two columns of rows once there are more than five
  const listCols = count > 5 ? 2 : 1
  const listRows = Math.ceil(count / listCols)
  const listWidth = PLATE_WIDTH / listCols
  const listHeight = Math.min(0.13, (ROWS_TOP - ROWS_BOTTOM) / listRows)
  const listTop = (ROWS_TOP + ROWS_BOTTOM) / 2 + (listHeight * listRows) / 2

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
        const fuse = {
          label,
          inserted: value.includes(i),
          stateLabel: value.includes(i) ? on : off,
          disabled,
          onToggle: () => toggle(i),
        }
        if (stacked) {
          const col = Math.floor(i / listRows)
          const row = i - col * listRows
          return (
            <RowFuse
              key={i}
              {...fuse}
              left={-PLATE_WIDTH / 2 + col * listWidth}
              y={listTop - (row + 0.5) * listHeight}
              width={listWidth}
              height={listHeight}
            />
          )
        }
        const row = Math.floor(i / cols)
        const inRow = row === rows - 1 ? count - cols * (rows - 1) : cols
        const col = i - row * cols
        return (
          <ColumnFuse
            key={i}
            {...fuse}
            x={(col - (inRow - 1) / 2) * width}
            top={firstTop - row * rowHeight}
            width={width}
            holderHeight={holderHeight}
          />
        )
      })}
    </group>
  )
}
