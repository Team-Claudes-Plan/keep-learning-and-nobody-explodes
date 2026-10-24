import { useMemo } from 'react'
import { Link, useParams } from 'react-router'
import Bomb from '../game/Bomb'
import { getModule, MODULES } from '../game/modules'
import NotFoundPage from './NotFoundPage'

/** Full bomb at /minigames/bomb, single-module practice at /minigames/modules/:moduleId. */
export default function BombPage() {
  const { moduleId } = useParams()
  const module = getModule(moduleId)
  const modules = useMemo(() => (module ? [module] : MODULES), [module])

  if (moduleId && !module) return <NotFoundPage />

  return (
    <div className="mg-page mg-page-wide">
      <header className="mg-header">
        <h1>{module ? `${module.icon} ${module.name}` : '💣 Bombe entschärfen'}</h1>
        <Link to="/minigames">← Alle Minigames</Link>
      </header>
      <Bomb key={moduleId ?? 'bomb'} modules={modules} />
    </div>
  )
}
