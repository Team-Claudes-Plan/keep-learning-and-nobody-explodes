import { Suspense, useMemo, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Float, Sparkles, Text } from '@react-three/drei'
import {
  CatmullRomCurve3,
  Color,
  Vector3,
  type Group,
  type Mesh,
  type MeshStandardMaterial,
  type MeshBasicMaterial,
  type PointLight,
} from 'three'

import { TITLE_LINES, type Burst, type TitleFxRef } from './titleFx'
import { playSfx } from '../../audio/sfx'

const FONT_URL = '/fonts/inter-latin-600.woff'

function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const easeOutBack = (x: number, c1 = 2.2) => {
  const c3 = c1 + 1
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/* ------------------------------------------------------------------ camera */

function CameraRig({ fx }: { fx: TitleFxRef }) {
  const camera = useThree((state) => state.camera)

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime
    const shake = fx.current.shake
    camera.position.set(
      Math.sin(t * 0.17) * 0.9 + (Math.random() - 0.5) * shake * 0.35,
      0.3 + Math.sin(t * 0.13) * 0.4 + (Math.random() - 0.5) * shake * 0.35,
      14,
    )
    camera.lookAt(0, 0.6, 0)
    fx.current.shake *= Math.exp(-dt * 6)
  })

  return null
}

/* ------------------------------------------------------------------- title */

const FACE_OUTLINE = '#1b1030'

function ExtrudedText({
  text,
  size,
  face,
  side,
  layers = 9,
}: {
  text: string
  size: number
  face: string
  side: string
  layers?: number
}) {
  const sideColors = useMemo(() => {
    const front = new Color(side)
    const back = new Color(side).multiplyScalar(0.45)
    return Array.from({ length: layers }, (_, i) =>
      '#' + front.clone().lerp(back, i / Math.max(1, layers - 1)).getHexString(),
    )
  }, [side, layers])
  const step = size * 0.035
  const shared = {
    font: FONT_URL,
    fontSize: size,
    anchorX: 'center' as const,
    anchorY: 'middle' as const,
    letterSpacing: 0.02,
  }

  return (
    <group>
      {sideColors.map((color, i) => (
        <Text
          key={i}
          {...shared}
          position={[0, -step * 0.4 * (i + 1), -step * (i + 1)]}
          color={color}
          outlineWidth={size * 0.07}
          outlineColor={color}
        >
          {text}
        </Text>
      ))}
      <Text {...shared} color={face} outlineWidth={size * 0.07} outlineColor={FACE_OUTLINE}>
        {text}
      </Text>
    </group>
  )
}

const LINES = [
  { text: TITLE_LINES[0], size: 1.05, y: 2.35, face: '#ffd23f', side: '#d9480f', delay: 0.15 },
  { text: TITLE_LINES[1], size: 0.62, y: 1.25, face: '#ffffff', side: '#5b3fd1', delay: 0.45 },
  { text: TITLE_LINES[2], size: 1.6, y: 0, face: '#ff4d2e', side: '#7a1010', delay: 0.8 },
]

function Title({ fx }: { fx: TitleFxRef }) {
  const viewport = useThree((state) => state.viewport)
  const lineRefs = useRef<(Group | null)[]>([])
  const fired = useRef(false)
  const scale = Math.min(1, viewport.width / 10.5)

  useFrame(({ clock }) => {
    const t = clock.elapsedTime

    if (!fired.current && t > LINES[2].delay + 0.05) {
      fired.current = true
      fx.current.bursts.push(
        { x: 0, y: 0.3, z: -3.5, scale: 2 },
        { x: -4.5, y: -0.5, z: -5, scale: 1.2 },
        { x: 4.5, y: 1.5, z: -5, scale: 1.2 },
      )
    }

    LINES.forEach((line, i) => {
      const group = lineRefs.current[i]
      if (!group) return
      const pop = easeOutBack(clamp01((t - line.delay) / 0.55))
      group.scale.setScalar(Math.max(0.0001, pop))
      group.rotation.y = Math.sin(t * 0.6 + i * 0.9) * 0.07
      group.rotation.z = Math.sin(t * 0.8 + i * 1.7) * 0.02
      const jitter = i === 2 ? fx.current.shake * 0.12 : fx.current.shake * 0.04
      group.position.set(
        (Math.random() - 0.5) * jitter,
        line.y + Math.sin(t * 1.3 + i) * 0.06 + (Math.random() - 0.5) * jitter,
        0,
      )
    })
  })

  return (
    <group position={[0, 1.25, 0]} scale={scale}>
      {LINES.map((line, i) => (
        <group
          key={line.text}
          ref={(node) => {
            lineRefs.current[i] = node
          }}
          scale={0.0001}
        >
          <ExtrudedText text={line.text} size={line.size} face={line.face} side={line.side} />
        </group>
      ))}
    </group>
  )
}

/* ---------------------------------------------------------------- bombs */

function CartoonBomb({ seed }: { seed: number }) {
  const spark = useRef<Group>(null)
  const light = useRef<PointLight>(null)
  const embers = useRef<(Mesh | null)[]>([])

  const { fuse, tip } = useMemo(() => {
    const curve = new CatmullRomCurve3([
      new Vector3(0, 1.05, 0),
      new Vector3(0.05, 1.35, 0.05),
      new Vector3(0.35, 1.6, 0.1),
      new Vector3(0.6, 1.55, 0.05),
    ])
    return { fuse: curve, tip: curve.getPoint(1) }
  }, [])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime * 1 + seed
    const flicker = 0.8 + Math.sin(t * 40) * 0.15 + Math.sin(t * 23) * 0.1
    spark.current?.scale.setScalar(flicker)
    if (spark.current) spark.current.rotation.z = t * 6
    if (light.current) light.current.intensity = 4 * flicker
    embers.current.forEach((ember, i) => {
      if (!ember) return
      const p = (t * 1.6 + i / embers.current.length) % 1
      const a = i * 2.4
      ember.position.set(
        tip.x + Math.cos(a) * p * 0.6,
        tip.y + Math.sin(a) * p * 0.4 + p * 0.5 - p * p * 0.6,
        tip.z + Math.sin(a * 1.3) * p * 0.3,
      )
      ember.scale.setScalar((1 - p) * 0.08)
    })
  })

  return (
    <group>
      <mesh>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color="#2b2d42" roughness={0.35} metalness={0.2} flatShading />
      </mesh>
      <mesh position={[-0.38, 0.42, 0.72]} scale={[0.22, 0.14, 0.05]} rotation={[0, 0, 0.6]}>
        <icosahedronGeometry args={[1, 0]} />
        <meshBasicMaterial color="#8d93b8" />
      </mesh>
      <mesh position={[0, 1, 0]}>
        <cylinderGeometry args={[0.32, 0.38, 0.28, 8]} />
        <meshStandardMaterial color="#6b6f80" flatShading />
      </mesh>
      <mesh>
        <tubeGeometry args={[fuse, 12, 0.06, 5, false]} />
        <meshStandardMaterial color="#c8a165" flatShading />
      </mesh>
      <group ref={spark} position={tip}>
        <mesh>
          <octahedronGeometry args={[0.2, 0]} />
          <meshBasicMaterial color="#ff8a1f" transparent opacity={0.85} />
        </mesh>
        <mesh>
          <octahedronGeometry args={[0.11, 0]} />
          <meshBasicMaterial color="#fff6c2" />
        </mesh>
      </group>
      <pointLight ref={light} position={tip} color="#ffb347" distance={5} decay={1.5} />
      {Array.from({ length: 8 }, (_, i) => (
        <mesh
          key={i}
          ref={(node) => {
            embers.current[i] = node
          }}
        >
          <tetrahedronGeometry args={[1, 0]} />
          <meshBasicMaterial color={i % 2 ? '#ffd23f' : '#ff7b1f'} />
        </mesh>
      ))}
    </group>
  )
}

const BOMBS = [
  { position: [-6.6, -1.6, -1] as const, scale: 1.1, seed: 0 },
  { position: [6.9, 2.6, -2.5] as const, scale: 0.9, seed: 3 },
  { position: [5.6, -3.4, 0.5] as const, scale: 0.6, seed: 7 },
  { position: [-5.4, 4.2, -4] as const, scale: 0.55, seed: 11 },
]

function Bombs() {
  return (
    <>
      {BOMBS.map((bomb) => (
        <Float key={bomb.seed} speed={1.6} rotationIntensity={0.8} floatIntensity={1.2}>
          <group position={bomb.position} scale={bomb.scale} rotation={[0.2, bomb.seed, -0.35]}>
            <CartoonBomb seed={bomb.seed} />
          </group>
        </Float>
      ))}
    </>
  )
}

/* -------------------------------------------------------- floating debris */

function Book({ color }: { color: string }) {
  return (
    <group>
      <mesh>
        <boxGeometry args={[0.82, 0.14, 0.6]} />
        <meshStandardMaterial color="#fbf3dc" flatShading />
      </mesh>
      {[0.085, -0.085].map((y) => (
        <mesh key={y} position={[0, y, 0]}>
          <boxGeometry args={[0.9, 0.03, 0.66]} />
          <meshStandardMaterial color={color} flatShading />
        </mesh>
      ))}
      <mesh position={[-0.44, 0, 0]}>
        <boxGeometry args={[0.03, 0.2, 0.66]} />
        <meshStandardMaterial color={color} flatShading />
      </mesh>
    </group>
  )
}

function SpeechBubble({ color }: { color: string }) {
  return (
    <group>
      <mesh scale={[0.75, 0.5, 0.25]}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color={color} flatShading />
      </mesh>
      <mesh position={[-0.35, -0.5, 0]} rotation={[0, 0, 0.5]}>
        <coneGeometry args={[0.15, 0.35, 4]} />
        <meshStandardMaterial color={color} flatShading />
      </mesh>
      {[-0.28, 0, 0.28].map((x) => (
        <mesh key={x} position={[x, 0, 0.24]}>
          <icosahedronGeometry args={[0.08, 0]} />
          <meshStandardMaterial color="#2b2d42" flatShading />
        </mesh>
      ))}
    </group>
  )
}

function Gear({ color }: { color: string }) {
  return (
    <group rotation={[Math.PI / 2, 0, 0]}>
      <mesh>
        <cylinderGeometry args={[0.45, 0.45, 0.18, 10]} />
        <meshStandardMaterial color={color} flatShading />
      </mesh>
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2
        return (
          <mesh key={i} position={[Math.cos(a) * 0.52, 0, Math.sin(a) * 0.52]} rotation={[0, -a, 0]}>
            <boxGeometry args={[0.18, 0.18, 0.16]} />
            <meshStandardMaterial color={color} flatShading />
          </mesh>
        )
      })}
    </group>
  )
}

function Rock({ color }: { color: string }) {
  return (
    <mesh>
      <dodecahedronGeometry args={[0.4, 0]} />
      <meshStandardMaterial color={color} flatShading />
    </mesh>
  )
}

const KINDS = [
  { Model: Book, colors: ['#e63946', '#3a86ff', '#2a9d8f', '#ffb703'] },
  { Model: SpeechBubble, colors: ['#ffffff', '#c7f9cc', '#ffe066'] },
  { Model: Gear, colors: ['#f2b134', '#adb5bd'] },
  { Model: Rock, colors: ['#8d6e63', '#6d597a'] },
]

type DrifterData = {
  kind: number
  color: string
  x: number
  y: number
  z: number
  speed: number
  spin: [number, number, number]
  scale: number
}

const DRIFTERS: DrifterData[] = (() => {
  const rand = prng(1337)
  return Array.from({ length: 24 }, (_, i) => {
    const kind = i % KINDS.length
    const front = i % 6 === 0
    const side = rand() < 0.5 ? -1 : 1
    return {
      kind,
      color: KINDS[kind].colors[Math.floor(rand() * KINDS[kind].colors.length)],
      x: front ? side * (6 + rand() * 4) : (rand() - 0.5) * 24,
      y: (rand() - 0.5) * 18,
      z: front ? 1 + rand() * 3 : -3 - rand() * 7,
      speed: 0.35 + rand() * 0.6,
      spin: [(rand() - 0.5) * 1.2, (rand() - 0.5) * 1.2, (rand() - 0.5) * 1.2],
      scale: 0.6 + rand() * 0.6,
    }
  })
})()

function Drifter({ data }: { data: DrifterData }) {
  const ref = useRef<Group>(null)
  const { Model } = KINDS[data.kind]

  useFrame(({ clock }, dt) => {
    const group = ref.current
    if (!group) return
    group.position.y += data.speed * dt
    if (group.position.y > 9) group.position.y = -9
    group.position.x = data.x + Math.sin(clock.elapsedTime * 0.4 + data.y) * 0.4
    group.rotation.x += data.spin[0] * dt
    group.rotation.y += data.spin[1] * dt
    group.rotation.z += data.spin[2] * dt
  })

  return (
    <group ref={ref} position={[data.x, data.y, data.z]} scale={data.scale}>
      <Model color={data.color} />
    </group>
  )
}

/* -------------------------------------------------------------- explosions */

const PUFFS = 7
const DEBRIS = 10
const SLOTS = 6
const GRAVITY = -7

type Slot = {
  active: boolean
  t: number
  x: number
  y: number
  z: number
  scale: number
  puffDirs: Vector3[]
  puffSizes: number[]
  debrisVel: Vector3[]
}

function makeSlot(): Slot {
  return {
    active: false,
    t: 0,
    x: 0,
    y: 0,
    z: 0,
    scale: 1,
    puffDirs: Array.from({ length: PUFFS }, () => new Vector3()),
    puffSizes: Array.from({ length: PUFFS }, () => 1),
    debrisVel: Array.from({ length: DEBRIS }, () => new Vector3()),
  }
}

function fire(slot: Slot, burst: Burst) {
  slot.active = true
  slot.t = 0
  slot.x = burst.x
  slot.y = burst.y
  slot.z = burst.z
  slot.scale = burst.scale
  // A distant, soft boom for every burst; nearer/larger bangs are louder and panned to their side.
  playSfx('distantBoom', {
    volume: 0.12 + burst.scale * 0.08,
    pan: Math.max(-1, Math.min(1, burst.x / 9)),
  })
  slot.puffDirs.forEach((dir, i) => {
    if (i === 0) dir.set(0, 0, 0)
    else dir.randomDirection().multiplyScalar(0.5 + Math.random() * 0.5)
  })
  slot.puffSizes.forEach((_, i) => {
    slot.puffSizes[i] = i === 0 ? 1.2 : 0.55 + Math.random() * 0.5
  })
  slot.debrisVel.forEach((vel) => {
    vel.randomDirection()
    vel.y = Math.abs(vel.y) + 0.3
    vel.multiplyScalar((4 + Math.random() * 4) * burst.scale)
  })
}

function randomBurst(): Burst {
  const side = Math.random() < 0.5 ? -1 : 1
  return {
    x: side * (2.5 + Math.random() * 6),
    y: -3.5 + Math.random() * 8,
    z: -4 - Math.random() * 7,
    scale: 0.6 + Math.random() * 0.8,
  }
}

const FIRE_STOPS: [number, Color][] = [
  [0, new Color('#ffffff')],
  [0.07, new Color('#fff3a8')],
  [0.2, new Color('#ffb020')],
  [0.38, new Color('#ff5a1f')],
  [0.62, new Color('#5d5157')],
  [1.4, new Color('#3a3438')],
]

function fireColor(t: number, target: Color) {
  for (let i = 1; i < FIRE_STOPS.length; i++) {
    const [t1, c1] = FIRE_STOPS[i]
    if (t <= t1) {
      const [t0, c0] = FIRE_STOPS[i - 1]
      return target.copy(c0).lerp(c1, (t - t0) / (t1 - t0))
    }
  }
  return target.copy(FIRE_STOPS[FIRE_STOPS.length - 1][1])
}

const DURATION = 1.7

function ExplosionView({ slots, index }: { slots: RefObject<Slot[]>; index: number }) {
  const group = useRef<Group>(null)
  const puffs = useRef<(Mesh | null)[]>([])
  const debris = useRef<(Mesh | null)[]>([])
  const ring = useRef<Mesh>(null)
  const light = useRef<PointLight>(null)

  useFrame((_, dt) => {
    const root = group.current
    const slot = slots.current[index]
    if (!root) return
    if (!slot.active) {
      root.visible = false
      return
    }
    slot.t += dt
    const t = slot.t
    const s = slot.scale
    root.visible = true
    root.position.set(slot.x, slot.y, slot.z)

    puffs.current.forEach((mesh, i) => {
      if (!mesh) return
      const local = Math.max(0, t - i * 0.015)
      const grow = 1 - (1 - clamp01(local / 0.35)) ** 3
      const dir = slot.puffDirs[i]
      mesh.position.set(
        dir.x * grow * 1.3 * s,
        dir.y * grow * 1.3 * s + local * local * 0.6 * s,
        dir.z * grow * 1.3 * s,
      )
      mesh.scale.setScalar(slot.puffSizes[i] * s * (0.2 + grow * 0.9 + local * 0.3))
      mesh.rotation.set(i + local * 0.8, i * 2 + local * 0.5, 0)
      const material = mesh.material as MeshStandardMaterial
      fireColor(local, material.color)
      material.emissive.copy(material.color)
      material.emissiveIntensity = 1 - clamp01((local - 0.3) / 0.35)
      material.opacity = 1 - clamp01((local - 0.8) / 0.8)
    })

    debris.current.forEach((mesh, i) => {
      if (!mesh) return
      const vel = slot.debrisVel[i]
      mesh.position.set(vel.x * t, vel.y * t + 0.5 * GRAVITY * t * t, vel.z * t)
      mesh.rotation.set(t * 7 + i, t * 5, t * 3)
      mesh.scale.setScalar(0.18 * s * (1 - clamp01((t - 1) / 0.6)))
    })

    if (ring.current) {
      const r = clamp01(t / 0.45)
      ring.current.scale.setScalar(0.3 + (1 - (1 - r) ** 2) * 3.5 * s)
      ;(ring.current.material as MeshBasicMaterial).opacity = (1 - r) * 0.85
    }

    if (light.current) light.current.intensity = 120 * s * (1 - clamp01(t / 0.4)) ** 2

    if (t > DURATION) slot.active = false
  })

  return (
    <group ref={group} visible={false}>
      {Array.from({ length: PUFFS }, (_, i) => (
        <mesh
          key={i}
          ref={(node) => {
            puffs.current[i] = node
          }}
        >
          <icosahedronGeometry args={[1, 0]} />
          <meshStandardMaterial transparent flatShading roughness={1} />
        </mesh>
      ))}
      {Array.from({ length: DEBRIS }, (_, i) => (
        <mesh
          key={i}
          ref={(node) => {
            debris.current[i] = node
          }}
        >
          <tetrahedronGeometry args={[1, 0]} />
          <meshStandardMaterial
            color={i % 3 === 0 ? '#ffb020' : '#3b2f2f'}
            emissive={i % 3 === 0 ? '#ff7b1f' : '#000000'}
            flatShading
          />
        </mesh>
      ))}
      <mesh ref={ring}>
        <ringGeometry args={[0.85, 1, 24]} />
        <meshBasicMaterial color="#fff3c4" transparent depthWrite={false} />
      </mesh>
      <pointLight ref={light} color="#ffa040" distance={18} decay={1.6} intensity={0} />
    </group>
  )
}

function Explosions({ fx }: { fx: TitleFxRef }) {
  const slots = useRef<Slot[]>(Array.from({ length: SLOTS }, makeSlot))
  const timer = useRef(2.2)

  useFrame((_, dt) => {
    timer.current -= dt
    if (timer.current <= 0) {
      timer.current = 0.8 + Math.random() * 1.8
      fx.current.bursts.push(randomBurst())
    }
    while (fx.current.bursts.length > 0) {
      const burst = fx.current.bursts.shift()!
      const pool = slots.current
      const slot =
        pool.find((candidate) => !candidate.active) ??
        pool.reduce((oldest, candidate) => (candidate.t > oldest.t ? candidate : oldest))
      fire(slot, burst)
      // Nearer and bigger bangs shake harder.
      const nearness = clamp01(1 - (-burst.z - 2) / 12)
      fx.current.shake = Math.max(fx.current.shake, burst.scale * (0.3 + nearness * 0.7))
    }
  })

  return (
    <>
      {Array.from({ length: SLOTS }, (_, i) => (
        <ExplosionView key={i} slots={slots} index={i} />
      ))}
    </>
  )
}

/* ------------------------------------------------------------------- scene */

export default function TitleScene({ fx }: { fx: TitleFxRef }) {
  return (
    <>
      <CameraRig fx={fx} />
      <hemisphereLight args={['#ffe8c2', '#3b1d6e', 1.4]} />
      <directionalLight position={[4, 8, 6]} intensity={2.2} color="#fff1d6" />
      <directionalLight position={[-6, -2, 4]} intensity={0.6} color="#9b7bff" />

      <Suspense fallback={null}>
        <Title fx={fx} />
      </Suspense>
      <Bombs />
      {DRIFTERS.map((data, i) => (
        <Drifter key={i} data={data} />
      ))}
      <Explosions fx={fx} />
      <Sparkles count={70} scale={[22, 13, 10]} position={[0, 0, -4]} size={4} speed={0.5} color="#ffd27a" />
    </>
  )
}
