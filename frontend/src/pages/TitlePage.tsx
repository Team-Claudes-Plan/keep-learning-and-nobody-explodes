import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Canvas } from '@react-three/fiber'
import TitleScene from '../components/title/TitleScene'
import { createTitleFx, TITLE_LINES, type TitleFx } from '../components/title/titleFx'
import { playCloudTransition } from '../components/transition/cloudTransition'
import './TitlePage.css'

export default function TitlePage() {
  const navigate = useNavigate()
  const fx = useRef<TitleFx>(createTitleFx())
  const [leaving, setLeaving] = useState(false)

  const play = () => {
    if (leaving) return
    setLeaving(true)
    // One last big bang, then the clouds roll in.
    fx.current.bursts.push({ x: 0, y: 0.5, z: -2.5, scale: 2.2 })
    window.setTimeout(() => playCloudTransition(() => navigate('/islands')), 180)
  }

  return (
    <div className="title-page">
      <div className="title-bg" aria-hidden="true">
        <div className="title-rays" />
      </div>

      <Canvas className="title-canvas" camera={{ position: [0, 0, 14], fov: 40 }} dpr={[1, 2]}>
        <TitleScene fx={fx} />
      </Canvas>

      <h1 className="visually-hidden">{TITLE_LINES.join(' ')}</h1>

      <div className="title-ui">
        <button type="button" className="play-button" onClick={play} disabled={leaving}>
          Play
        </button>
      </div>
    </div>
  )
}
