import { Link } from 'react-router'
import { MODULES } from '../game/modules'

export default function MinigamesPage() {
  return (
    <div className="mg-page">
      <header className="mg-header">
        <h1>Minigames</h1>
        <Link to="/islands">← Zu den Inseln</Link>
      </header>
      <div className="mg-grid">
        <Link to="/minigames/bomb" className="mg-tile mg-tile-main">
          <span className="mg-tile-icon">💣</span>
          <span className="mg-tile-name">Bombe entschärfen</span>
          <span className="mg-muted">Alle Module, zufällige Fragen, 3 Fehler erlaubt.</span>
        </Link>
        {MODULES.map((module) => (
          <Link key={module.id} to={`/minigames/modules/${module.id}`} className="mg-tile">
            <span className="mg-tile-icon">{module.icon}</span>
            <span className="mg-tile-name">{module.name}</span>
            <span className="mg-muted">{module.description}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
