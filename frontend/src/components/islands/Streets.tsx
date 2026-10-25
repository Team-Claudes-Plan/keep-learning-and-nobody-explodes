import { useMemo } from 'react'
import {
  GRID_BLOCKS,
  GRID_EXTENT,
  ROAD_LINES,
  ROAD_WIDTH,
  buildFieldProps,
  type FieldProp,
  type GridBlock,
} from '../../data/islandGrid'
import GrassBlock from './GrassBlock'

const ROAD_COLOR = '#262b33'
const MARKING_COLOR = '#e6e2d0'
const DASH_LENGTH = 0.32
const DASH_GAP = 0.36

type Dash = { x: number; z: number; axis: 'x' | 'z' }

function buildDashes(): Dash[] {
  const dashes: Dash[] = []
  const isIntersection = (value: number) =>
    ROAD_LINES.some((line) => Math.abs(line - value) < ROAD_WIDTH * 0.75)

  for (const line of ROAD_LINES) {
    for (let t = -GRID_EXTENT + DASH_LENGTH; t <= GRID_EXTENT - DASH_LENGTH; t += DASH_LENGTH + DASH_GAP) {
      if (!isIntersection(t)) {
        dashes.push({ x: t, z: line, axis: 'x' })
        dashes.push({ x: line, z: t, axis: 'z' })
      }
    }
  }
  return dashes
}

const DASHES = buildDashes()

function Road({ axis, offset }: { axis: 'x' | 'z'; offset: number }) {
  const length = GRID_EXTENT * 2
  const size: [number, number] = axis === 'x' ? [length, ROAD_WIDTH] : [ROAD_WIDTH, length]
  const position: [number, number, number] = axis === 'x' ? [0, 0.012, offset] : [offset, 0.012, 0]
  return (
    <mesh rotation-x={-Math.PI / 2} position={position} raycast={() => null}>
      <planeGeometry args={size} />
      <meshStandardMaterial color={ROAD_COLOR} roughness={1} />
    </mesh>
  )
}

function Prop({ prop }: { prop: FieldProp }) {
  const { kind, position, rotation, scale, color } = prop
  if (kind === 'tree') {
    return (
      <group position={position} rotation-y={rotation} scale={scale}>
        <mesh position={[0, 0.2, 0]} raycast={() => null}>
          <cylinderGeometry args={[0.055, 0.075, 0.4, 6]} />
          <meshStandardMaterial color="#6b4a2f" roughness={1} />
        </mesh>
        <mesh position={[0, 0.62, 0]} raycast={() => null}>
          <coneGeometry args={[0.32, 0.72, 6]} />
          <meshStandardMaterial color={color} roughness={1} />
        </mesh>
      </group>
    )
  }

  if (kind === 'bush') {
    return (
      <mesh position={[position[0], position[1] + 0.09, position[2]]} rotation-y={rotation} scale={[scale, scale * 0.75, scale]} raycast={() => null}>
        <icosahedronGeometry args={[0.22, 0]} />
        <meshStandardMaterial color={color} roughness={1} flatShading />
      </mesh>
    )
  }

  return (
    <group position={position} rotation-y={rotation}>
      <mesh position={[0, 0.35, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.035, 0.045, 0.7, 6]} />
        <meshStandardMaterial color="#3a3f47" roughness={0.7} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.72, 0]} raycast={() => null}>
        <sphereGeometry args={[0.075, 10, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.1} />
      </mesh>
    </group>
  )
}

/** Roads, sidewalks and the island grid; free cells get trees, bushes and lamps. */
export default function Streets({ fieldBlocks }: { fieldBlocks: GridBlock[] }) {
  const fieldProps = useMemo(() => buildFieldProps(fieldBlocks), [fieldBlocks])
  return (
    <group>
      {GRID_BLOCKS.map((block) => (
        <GrassBlock key={`${block.i}-${block.j}`} center={block.center} color={block.color} />
      ))}

      {ROAD_LINES.map((line) => (
        <group key={`road-x-${line}`}>
          <Road axis="x" offset={line} />
          <Road axis="z" offset={line} />
        </group>
      ))}

      {DASHES.map((dash, index) => (
        <mesh
          key={`dash-${index}`}
          rotation-x={-Math.PI / 2}
          position={[dash.x, 0.02, dash.z]}
          raycast={() => null}
        >
          <planeGeometry args={dash.axis === 'x' ? [DASH_LENGTH, 0.07] : [0.07, DASH_LENGTH]} />
          <meshStandardMaterial color={MARKING_COLOR} roughness={1} />
        </mesh>
      ))}

      {fieldProps.map((prop) => (
        <Prop key={prop.id} prop={prop} />
      ))}
    </group>
  )
}
