import { Link } from 'react-router'
import Hud from '../components/Hud'

export default function NotFoundPage() {
  return (
    <Hud title="Not found">
      <div>This page does not exist.</div>
      <div className="hud-links">
        <Link to="/islands">Back to the islands</Link>
      </div>
    </Hud>
  )
}
