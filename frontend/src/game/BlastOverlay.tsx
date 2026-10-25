import { useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { BLAST_DELAY } from './Bomb3D'
import { playBoom } from './boom'
import Explosion from './Explosion'

/** How long the fireball and sparks need; then the canvas goes away again. */
const FIRE_SECONDS = 2.6

/**
 * The bomb going off for whoever does not see the bomb (the expert): the same boom, flash, fireball
 * and sparks, over whatever is on screen. Mount it to set it off; it waits as long as the defuser's
 * camera needs to pull back, so both see it at about the same moment.
 */
export default function BlastOverlay({ onBlast }: { onBlast?: () => void }) {
  const [phase, setPhase] = useState<'waiting' | 'fire' | 'done'>('waiting')

  useEffect(() => {
    if (phase === 'waiting') {
      const id = setTimeout(() => {
        playBoom()
        setPhase('fire')
        onBlast?.()
      }, BLAST_DELAY * 1000)
      return () => clearTimeout(id)
    }
    if (phase === 'fire') {
      const id = setTimeout(() => setPhase('done'), FIRE_SECONDS * 1000)
      return () => clearTimeout(id)
    }
  }, [phase, onBlast])

  if (phase === 'waiting') return null
  return (
    <div className="blast-overlay" aria-hidden>
      {phase === 'fire' && (
        <Canvas className="blast-overlay-fire" camera={{ position: [0, 0, 8], fov: 50 }} gl={{ alpha: true }}>
          <Explosion center={[0, 0, 0]} />
        </Canvas>
      )}
      <div className="blast-overlay-soot" />
      <div className="bomb-flash" />
    </div>
  )
}
