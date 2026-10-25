import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import SceneCanvas from '../components/SceneCanvas'
import Hud from '../components/Hud'
import Bridge from '../components/islands/Bridge'
import IslandCamera from '../components/islands/IslandCamera'
import IslandScene from '../components/islands/IslandScene'
import { IslandPartner, NewIsland, You } from '../components/islands/IslandActions'
import UploadDialog, { UploadIcon } from '../components/islands/UploadDialog'
import BannerDialog from '../components/islands/BannerDialog'
import WelcomeDialog from '../components/islands/WelcomeDialog'
import { usePresence, useIslands } from '../api/useIslands'
import type { IslandsResponse } from '../api/types'
import { bridgeBetween, islandCenter, resolveIsland } from '../data/islands'

const MIN_ZOOM = 30

function IslandsView({ data }: { data: IslandsResponse }) {
  const navigate = useNavigate()
  const { islandId } = useParams()
  const [storeyDelta, setStoreyDelta] = useState(0)
  const [uploadOpen, setUploadOpen] = useState(false)
  const { me, islands } = data

  const resolved = useMemo(() => islands.map(resolveIsland), [islands])
  const activeIndex = Math.max(0, islands.findIndex((island) => island.id === islandId))
  const active = resolved[activeIndex]

  const memberIds = useMemo(
    () => islands.flatMap((island) => island.group.members.map((member) => member.id)),
    [islands],
  )
  const presence = usePresence(memberIds, me.id)

  const open = useCallback((id: string) => navigate(`/islands/${id}`, { replace: true }), [navigate])

  const goTo = useCallback(
    (index: number) => {
      const island = islands[index]
      if (island) navigate(`/islands/${island.id}`, { replace: true })
    },
    [islands, navigate],
  )

  useEffect(() => {
    // The upload is tied to the current island, so stay put while the dialog is open.
    if (uploadOpen) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') goTo(activeIndex + 1)
      if (event.key === 'ArrowLeft') goTo(activeIndex - 1)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [activeIndex, goTo, uploadOpen])

  if (!active) {
    return (
      <BannerDialog
        title="No islands yet"
        subtitle={`Hi ${me.name}!`}
        lead="Create an island and upload your documents; their topics become its houses."
      >
        <NewIsland onCreated={open} inline />
        <You me={me} className="welcome-details" />
      </BannerDialog>
    )
  }

  const prev = islands[activeIndex - 1]
  const next = islands[activeIndex + 1]

  return (
    <>
      <SceneCanvas grid={false} controls={{ minZoom: MIN_ZOOM, maxZoom: 300 }} onPointerMissed={() => undefined}>
        {resolved.map((entry, index) => (
          <IslandScene
            key={entry.island.id}
            resolved={entry}
            center={islandCenter(index)}
            me={me}
            presence={presence}
            storeyDelta={storeyDelta}
            onHouseClick={(topicId) => navigate(`/islands/${entry.island.id}/houses/${topicId}`)}
          />
        ))}

        {islands.slice(1).map((island, index) => (
          <Bridge
            key={`${islands[index].id}-${island.id}`}
            span={bridgeBetween(index)}
            activeIndex={activeIndex}
            leftName={islands[index].name}
            rightName={island.name}
            onCross={goTo}
          />
        ))}

        <IslandCamera center={islandCenter(activeIndex)} minZoom={MIN_ZOOM} />
      </SceneCanvas>

      <Hud title={active.island.name}>
        {active.island.origin_id && (
          <div className="hud-note">
            Shares its houses with{' '}
            {islands.find((island) => island.id === active.island.origin_id)?.name ?? 'the island it was forked from'}
          </div>
        )}
        <ul className="hud-members">
          {active.island.group.members.map((member) => {
            const status = presence[member.id] ?? 'offline'
            return (
              <li key={member.id} className={`is-${status}`}>
                <span className="avatar-dot" />
                {member.id === me.id ? `${member.name} (you)` : member.name}
                <span className="hud-concept">{status}</span>
              </li>
            )
          })}
        </ul>

        {islands.length > 1 && (
          <div className="hud-buttons">
            <button type="button" disabled={!prev} onClick={() => goTo(activeIndex - 1)}>
              ←
            </button>
            <span className="hud-island-count">
              Island {activeIndex + 1} of {islands.length}
            </span>
            <button type="button" disabled={!next} onClick={() => goTo(activeIndex + 1)}>
              →
            </button>
          </div>
        )}

        <div className="hud-section">Controls</div>
        <div>Drag to pan &middot; Scroll to zoom</div>
        <div>Click a bridge (or ← →) to visit another island</div>
        <div>Click a building to enter</div>

        <div className="hud-section">Preview storeys</div>
        <div className="hud-buttons">
          {[-2, -1, 0, 1, 2, 4].map((delta) => (
            <button
              key={delta}
              type="button"
              className={storeyDelta === delta ? 'active' : ''}
              onClick={() => setStoreyDelta(delta)}
            >
              {delta === 0 ? 'Actual' : delta > 0 ? `+${delta}` : delta}
            </button>
          ))}
        </div>

        <div className="hud-section">Houses</div>
        {active.island.houses.length === 0 && <div>No houses yet: upload documents to build some.</div>}
        <ul className="hud-links">
          {active.houses.map((placed) => (
            <li key={placed.topicId}>
              <Link to={`/islands/${active.island.id}/houses/${placed.topicId}`}>{placed.name}</Link>
              <span className="hud-concept">
                {placed.unlocked ? `${placed.level}/${placed.totalStoreys} storeys` : 'no questions yet'}
              </span>
            </li>
          ))}
          {active.unplaced.map((topic) => (
            <li key={topic.topic_id}>
              {topic.name}
              <span className="hud-concept">no room on the island yet</span>
            </li>
          ))}
        </ul>

        <div className="hud-section">Island</div>
        <IslandPartner island={active.island} onForked={open} />
        <NewIsland onCreated={open} />
        <You me={me} />
      </Hud>

      <button
        type="button"
        className="upload-fab"
        onClick={() => setUploadOpen(true)}
        title={`Upload documents to ${active.island.name}`}
        aria-label={`Upload documents to ${active.island.name}`}
      >
        <span className="upload-fab-body chamfer">
          <span className="upload-fab-face chamfer">
            <UploadIcon size={40} className="upload-fab-icon" />
            <span className="upload-fab-label">Upload</span>
          </span>
        </span>
      </button>

      {uploadOpen && <UploadDialog island={active.island} onClose={() => setUploadOpen(false)} />}
    </>
  )
}

export default function IslandsPage() {
  const state = useIslands()

  if (state.status === 'loading') return null
  if (state.status === 'signed-out') return <WelcomeDialog />
  if (state.status === 'error') {
    return (
      <Hud title="Islands">
        <div>⚠️ Could not load your islands: {state.message}</div>
      </Hud>
    )
  }
  return <IslandsView data={state.data} />
}
