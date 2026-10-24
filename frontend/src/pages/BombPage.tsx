import { useMemo } from 'react'
import { useParams } from 'react-router'
import Bomb from '../game/Bomb'
import { getModule, MODULES } from '../game/modules'
import NotFoundPage from './NotFoundPage'

/**
 * Full bomb at /minigames/bomb, single-module practice at /minigames/modules/:moduleId. Both have the
 * test bar to pick a question type and try all of its tasks.
 */
export default function BombPage() {
  const { moduleId } = useParams()
  const module = getModule(moduleId)
  const modules = useMemo(() => (module ? [module] : MODULES), [module])

  if (moduleId && !module) return <NotFoundPage />

  return <Bomb key={moduleId ?? 'bomb'} modules={modules} testBar />
}
