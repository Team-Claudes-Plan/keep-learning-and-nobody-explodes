import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html, Text } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import type * as THREE from 'three'
import { FACE, FONT_URL } from './module3d'
import { ModuleHeading } from './Label3D'
import type { ModuleProps } from './types'

type Props = ModuleProps<'text'> | ModuleProps<'number'>

const SCREEN_GREEN = '#3dff8a'
const MAX_SHOWN = 42

function parseNumber(input: string): number | null {
  const trimmed = input.trim().replace(',', '.')
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

/** Blinking block cursor after the typed text. */
function Cursor({ active }: { active: boolean }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (ref.current) ref.current.visible = active && Math.floor(clock.elapsedTime * 2) % 2 === 0
  })
  return (
    <mesh ref={ref} position={[0.02, 0, 0]}>
      <planeGeometry args={[0.03, 0.055]} />
      <meshBasicMaterial color={SCREEN_GREEN} toneMapped={false} />
    </mesh>
  )
}

/**
 * Terminal on the bomb: type straight into its green screen, Enter submits.
 * Keys go into an invisible input (so paste, umlauts and phone keyboards work); the screen mirrors it.
 */
export default function TerminalModule3D(props: Props) {
  const isNumber = props.primitive.kind === 'number'
  const unit = props.primitive.kind === 'number' ? props.primitive.unit : null
  const uppercase = props.primitive.kind === 'text' && props.primitive.uppercase
  const user = props.primitive.kind === 'text' ? props.primitive.user : undefined
  const [input, setInput] = useState(() => (props.value === null ? '' : String(props.value)))
  const [typedWidth, setTypedWidth] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Grab the keyboard while this module is open. The input mounts a frame later (it lives in an <Html>
  // portal), so retry briefly, and pull focus back on any key press that went elsewhere.
  useEffect(() => {
    if (props.disabled) return
    let frame = 0
    let tries = 0
    const grab = () => {
      if (inputRef.current) inputRef.current.focus()
      else if (tries++ < 30) frame = requestAnimationFrame(grab)
    }
    grab()
    const onKey = () => {
      if (document.activeElement !== inputRef.current) inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [props.disabled])

  function change(raw: string) {
    const next = uppercase ? raw.toUpperCase() : raw
    setInput(next)
    if (isNumber) (props as ModuleProps<'number'>).onChange(parseNumber(next))
    else (props as ModuleProps<'text'>).onChange(next)
  }

  function focusInput(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation()
    if (!props.disabled) inputRef.current?.focus()
  }

  const invalid = isNumber && input.trim() !== '' && parseNumber(input) === null
  const shown = input.length > MAX_SHOWN ? `…${input.slice(-MAX_SHOWN)}` : input

  return (
    <group>
      <ModuleHeading text={props.heading} />

      {/* bezel + screen */}
      <mesh position={[0, 0.03, FACE + 0.02]}>
        <boxGeometry args={[0.86, 0.5, 0.04]} />
        <meshStandardMaterial color="#14171c" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.03, FACE + 0.041]} onClick={focusInput}>
        <planeGeometry args={[0.8, 0.44]} />
        {/* unlit: a glowing screen, no glare from the room light washing out the text */}
        <meshBasicMaterial color="#062414" toneMapped={false} />
      </mesh>

      <group position={[-0.37, 0, FACE + 0.043]}>
        <Text font={FONT_URL} position={[0, 0.19, 0]} fontSize={user ? 0.038 : 0.028} anchorX="left" anchorY="middle" color={SCREEN_GREEN}>
          {user ? `USER: ${user}` : 'SYSTEM GESPERRT · EINGABE ERFORDERLICH'}
        </Text>
        {/* login screen: the answer is the forgotten password */}
        {user && (
          <Text font={FONT_URL} position={[0, 0.125, 0]} fontSize={0.038} anchorX="left" anchorY="middle" color={SCREEN_GREEN}>
            PASSWORT:
          </Text>
        )}
        <Text font={FONT_URL} position={[0, 0.06, 0]} fontSize={0.06} anchorX="left" anchorY="middle" color={SCREEN_GREEN}>
          {'>'}
        </Text>
        <group position={[0.06, 0.06, 0]}>
          <Text
            font={FONT_URL}
            fontSize={0.06}
            maxWidth={0.64}
            anchorX="left"
            anchorY="middle"
            color={SCREEN_GREEN}
            onSync={(text: { textRenderInfo?: { blockBounds?: number[] } }) => {
              const b = text.textRenderInfo?.blockBounds
              setTypedWidth(b && shown ? b[2] - b[0] : 0)
            }}
          >
            {shown || ' '}
          </Text>
          <group position={[typedWidth, 0, 0]}>
            <Cursor active={!props.disabled} />
          </group>
        </group>
        {unit && (
          <Text font={FONT_URL} position={[0.72, -0.06, 0]} fontSize={0.04} anchorX="right" anchorY="middle" color={SCREEN_GREEN}>
            {unit}
          </Text>
        )}
        {invalid && (
          <Text font={FONT_URL} position={[0, -0.14, 0]} fontSize={0.03} anchorX="left" anchorY="middle" color="#ff5a5a">
            FEHLER: KEINE GÜLTIGE ZAHL
          </Text>
        )}
      </group>

      {/* keyboard, decoration only */}
      {Array.from({ length: 3 }, (_, r) =>
        // 7 columns: the bottom-right corner is kept free for the lock-in button.
        Array.from({ length: r === 2 ? 5 : 7 }, (_, c) => (
          <mesh key={`${r}-${c}`} position={[-0.375 + c * 0.083, -0.27 - r * 0.065, FACE + 0.012]}>
            <boxGeometry args={[0.07, 0.05, 0.024]} />
            <meshStandardMaterial color="#e8e6e1" roughness={0.6} />
          </mesh>
        )),
      )}

      {/* The real input: invisible, it just receives the keys. */}
      <Html position={[0, 0.03, FACE]} style={{ pointerEvents: 'none' }}>
        <input
          ref={inputRef}
          className="mod3d-hidden-input"
          value={input}
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && props.onLockIn()}
          disabled={props.disabled}
          inputMode={isNumber ? 'decimal' : 'text'}
          autoComplete="off"
          spellCheck={false}
          aria-label={isNumber ? 'Zahl' : 'Antwort'}
        />
      </Html>
    </group>
  )
}
