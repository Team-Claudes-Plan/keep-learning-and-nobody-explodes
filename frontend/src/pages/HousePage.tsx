import { Suspense, useEffect, useMemo, useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { Link, Navigate, useParams } from 'react-router'
import SceneCanvas from '../components/SceneCanvas'
import Room from '../components/Room'
import StoreyWallDressing from '../components/storey/StoreyWallDressing'
import Streets from '../components/islands/Streets'
import Island from '../components/islands/Island'
import { NO_FRONT } from '../components/roomWalls'
import Hud from '../components/Hud'
import { useWallTextures } from '../components/facade/useHouseTextures'
import { useInteriorTextures } from '../components/interior/useInteriorTextures'
import type { SurfaceSpec } from '../components/surfaces'
import { houseHeight, type House, type Storey } from '../data/houses'
import { MAX_HOUSE_LEVEL, type PlacedHouse, type ResolvedIsland } from '../data/islands'
import { useIslandHouse } from '../data/useIslandHouse'
import {
  DEFAULT_WALL_ATLAS,
  decorForHouse,
  resolveParts,
  type Decor,
  type HouseParts,
} from '../data/houseParts'
import { resolveDesign } from '../data/baseDesigns'
import { resolveConcept } from '../data/storeyConcepts'
import type { InteriorDesign } from '../data/interiorTypes'
import { isDrag } from '../components/interaction'
import KitFacade, { useKitCrownHeight } from '../components/facade/KitFacade'
import { HOUSE_KITS, type HouseKitId } from '../data/houseKits'
import { useIslands } from '../api/useIslands'
import SessionStart from '../components/session/SessionStart'
import { useInviteFlow } from '../game/useInviteFlow'

const WALL_THICKNESS = 0.08
/** Gap between a room's outer wall and the kit shell around it. */
const SHELL_GAP = 0.04

type StoreyRoomProps = {
  house: House
  storey: Storey
  index: number
  offset: number
  size: [number, number]
  outerSurface: SurfaceSpec
  innerSurface: SurfaceSpec
  parts: HouseParts
  edgeColor: string
  decor: Decor
  ceiling?: boolean
  selected?: boolean
  onClick: () => void
}

function StoreyRoom({
  house,
  storey,
  index,
  offset,
  size,
  outerSurface,
  innerSurface,
  parts,
  edgeColor,
  decor,
  ceiling = false,
  selected = false,
  onClick,
}: StoreyRoomProps) {
  const [hovered, setHovered] = useState(false)
  const concept = resolveConcept(house.id, storey.id, index, storey.concept)
  const floorDesign = useMemo<InteriorDesign>(
    () => ({ motif: 'tiles', floor: house.storeys[0].room.floorColor, accent: house.facadeColor }),
    [house],
  )
  const interior = useInteriorTextures(house.id, floorDesign)

  const [w, d] = size
  const h = storey.height

  const floorSurface: SurfaceSpec = {
    textures: interior,
    color: floorDesign.floor,
    emissiveIntensity: 0.25,
    roughness: 0.7,
    metalness: 0,
    tileWidth: 2,
    tileHeight: 2,
  }

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (isDrag(event)) return
    event.stopPropagation()
    onClick()
  }

  const handlePointerOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    setHovered(true)
    document.body.style.cursor = 'pointer'
  }

  const handlePointerOut = () => {
    setHovered(false)
    document.body.style.cursor = 'auto'
  }

  return (
    <group
      position={[0, offset, 0]}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      <Room
        size={[w, h, d]}
        floorColor={storey.room.floorColor}
        wallColor={storey.room.wallColor}
        walls={ceiling ? { ...NO_FRONT, ceiling: true } : NO_FRONT}
        highlighted={hovered || selected}
        outerSurface={outerSurface}
        innerSurface={innerSurface}
        floorSurface={floorSurface}
        ceilingSurface={innerSurface}
        edgeColor={edgeColor}
      />

      <group position={[0, h / 2, -d / 2 + WALL_THICKNESS / 2 + 0.005]}>
        <StoreyWallDressing
          width={w}
          height={h}
          parts={parts}
          decor={decor}
          label={concept.label}
          glow={hovered || selected ? 1 : 0}
        />
      </group>
    </group>
  )
}

type KitShellProps = {
  kit: HouseKitId
  /** Room size: width and depth, as the rooms are drawn. */
  room: [number, number]
  /** Kit depth to use, the house's real footprint depth. */
  depth: number
  storeyHeights: number[]
  /** Reports how far the roof reaches above the top storey. */
  onRoofHeight: (height: number) => void
}

/**
 * The house's city model wrapped around the stack of rooms, with the front cut open
 * so the rooms show through. Rooms are centred on the origin; the kit's front lines up
 * with the rooms' open front (minus the kit's recess).
 */
function KitShell({ kit, room, depth, storeyHeights, onRoofHeight }: KitShellProps) {
  const roofHeight = useKitCrownHeight(kit)
  useEffect(() => onRoofHeight(roofHeight), [roofHeight, onRoofHeight])

  const [w, d] = room
  const outer = WALL_THICKNESS / 2 + SHELL_GAP
  const kitW = w + 2 * outer
  const recess = (HOUSE_KITS[kit].frontRecess ?? 0) * depth
  const front = d / 2 + outer + recess
  const height = storeyHeights.reduce((sum, h) => sum + h, 0)
  const footprint = useMemo<[number, number]>(() => [kitW, depth], [kitW, depth])

  // Everything between the side walls, in front of the back wall, from the floor to the roof.
  const cutaway = useMemo(
    () => ({
      min: [-w / 2 - WALL_THICKNESS / 2, -WALL_THICKNESS, -d / 2 - WALL_THICKNESS / 2] as [number, number, number],
      max: [w / 2 + WALL_THICKNESS / 2, height, 1000] as [number, number, number],
    }),
    [w, d, height],
  )

  return (
    <group position={[0, 0, front - depth / 2]}>
      <KitFacade kit={kit} footprint={footprint} storeyHeights={storeyHeights} hovered={false} cutaway={cutaway} />
    </group>
  )
}

function HouseView({ island, placed }: { island: ResolvedIsland; placed: PlacedHouse }) {
  const { house } = placed
  const base = `/islands/${island.island.id}/houses/${placed.topicId}`

  // Clicking a room picks it; the game starts from the panel, together with the island partner.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedIndex = house.storeys.findIndex((storey) => storey.id === selectedId)
  const selected = selectedIndex >= 0 ? house.storeys[selectedIndex] : null
  const islands = useIslands()
  const meId = islands.status === 'ready' ? islands.data.me.id : undefined
  const partner = island.island.group.members.find((member) => member.id !== meId) ?? null
  const target = useMemo(
    () => (selectedId ? { islandId: island.island.id, topicId: placed.topicId, storeyId: selectedId } : null),
    [island.island.id, placed.topicId, selectedId],
  )
  const invite = useInviteFlow(partner, target)
  const close = () => {
    invite.cancel()
    setSelectedId(null)
  }
  const design = resolveDesign(house.facade.design)
  const atlas = house.facade.atlas ?? DEFAULT_WALL_ATLAS
  const wall = useWallTextures(house.facade.textures, design, atlas)

  const totalHeight = houseHeight(house)
  // Lets the view scroll up far enough to show the whole roof.
  const [roofHeight, setRoofHeight] = useState(0)
  const [w, d] = house.footprint
  const [blockX, blockZ] = placed.position
  const offsets = house.storeys.map((_, index) =>
    house.storeys.slice(0, index).reduce((sum, storey) => sum + storey.height, 0),
  )

  const storeyHeights = useMemo(() => house.storeys.map((storey) => storey.height), [house])

  const focusIndex = Math.floor((house.storeys.length - 1) / 2)
  const focusY = offsets[focusIndex] + house.storeys[focusIndex].height / 2

  const outerSurface: SurfaceSpec = {
    textures: wall.outer,
    color: design.material.tint,
    emissiveIntensity: design.material.emissiveIntensity,
    roughness: design.material.roughness,
    metalness: design.material.metalness,
    tileWidth: design.tiling.tileWidth,
    tileHeight: design.tiling.tileHeight,
  }

  const innerSurface: SurfaceSpec = {
    textures: wall.inner,
    color: design.material.tint,
    emissiveIntensity: design.material.emissiveIntensity,
    roughness: design.material.roughness,
    metalness: design.material.metalness,
    tileWidth: design.tiling.tileWidth,
    tileHeight: design.tiling.tileHeight,
  }

  return (
    <>
      <SceneCanvas
        camera={{ position: [1.8, focusY + 1.8, 16], zoom: 340, near: 0.1, far: 1000 }}
        controls={{ target: [0, focusY, 0] }}
        verticalScroll={{ min: 0.6, max: totalHeight + roofHeight - 0.6, step: 0.4 }}
        grid={false}
        fog={['#cfe8ff', 15, 26]}
      >
        <group position={[-blockX, -0.12, -blockZ]}>
          <Island />
          <Streets fieldBlocks={island.fieldBlocks} />
        </group>

        {house.kit && (
          <KitShell
            kit={house.kit}
            room={[w, d / 2]}
            depth={d}
            storeyHeights={storeyHeights}
            onRoofHeight={setRoofHeight}
          />
        )}

        {house.storeys.map((storey, index) => {
          const parts = resolveParts({ ...house.parts, ...storey.parts }, design.material.tint)
          const decor = decorForHouse(house.decorColor ?? house.facadeColor, index)
          return (
            <StoreyRoom
              key={storey.id}
              house={house}
              storey={storey}
              index={index}
              offset={offsets[index]}
              size={[w, d / 2]}
              outerSurface={outerSurface}
              innerSurface={innerSurface}
              parts={parts}
              edgeColor={house.kit ? HOUSE_KITS[house.kit].trim : parts.edge}
              decor={decor}
              ceiling={index === house.storeys.length - 1}
              selected={storey.id === selectedId}
              onClick={() => invite.flow.step !== 'waiting' && setSelectedId(storey.id)}
            />
          )
        })}
      </SceneCanvas>

      <Hud title={house.name}>
        <div className="hud-breadcrumb">
          <Link to={`/islands/${island.island.id}`}>{island.island.name}</Link> / <span>{house.name}</span>
        </div>
        <div>
          Level {placed.level} of {MAX_HOUSE_LEVEL}
        </div>
        {!placed.unlocked && (
          <div>
            {island.island.group.members.length > 1
              ? 'Not everyone on this island has learned this topic yet. Play its questions together to build it up.'
              : 'You have not learned this topic yet. Play its questions to build it up.'}
          </div>
        )}
        <div>Scroll or drag to move between storeys &middot; click a floor to start a session there</div>
        <ul className="hud-links">
          {house.storeys.map((storey, index) => {
            const concept = resolveConcept(house.id, storey.id, index, storey.concept)
            return (
              <li key={storey.id}>
                <Link
                  to={`${base}/storeys/${storey.id}`}
                  onClick={(event) => {
                    event.preventDefault()
                    if (invite.flow.step !== 'waiting') setSelectedId(storey.id)
                  }}
                >
                  {storey.label}
                  <span className="hud-concept">{concept.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </Hud>

      {selected && (
        <SessionStart
          storeyLabel={selected.label}
          conceptLabel={resolveConcept(house.id, selected.id, selectedIndex, selected.concept).label}
          partner={partner}
          partnerOnline={invite.partnerOnline}
          flow={invite.flow}
          onStart={invite.start}
          onCancel={invite.cancel}
          onClose={close}
          soloPath={`${base}/storeys/${selected.id}`}
        />
      )}
    </>
  )
}

export default function HousePage() {
  const { islandId = '', topicId = '' } = useParams()
  const state = useIslandHouse(islandId, topicId)

  if (state.status === 'loading') return null
  if (state.status === 'signed-out') return <Navigate to="/islands" replace />
  if (state.status !== 'ready') {
    return (
      <Hud title="House not found">
        <div>
          {state.status === 'error' ? (
            <>⚠️ {state.message}</>
          ) : (
            <>
              No house <strong>{topicId}</strong> on island <strong>{islandId}</strong>.
            </>
          )}
        </div>
        <div className="hud-links">
          <Link to="/islands">Back to the islands</Link>
        </div>
      </Hud>
    )
  }

  return (
    <Suspense fallback={null}>
      <HouseView island={state.island} placed={state.placed} />
    </Suspense>
  )
}
