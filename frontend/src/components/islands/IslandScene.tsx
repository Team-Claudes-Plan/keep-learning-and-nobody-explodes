import { useMemo } from 'react'
import type { PresenceStatus, UserSummary } from '../../api/types'
import { BLOCK_SIZE, SIDEWALK_WIDTH } from '../../data/islandGrid'
import { previewHeights } from '../../data/houses'
import type { ResolvedIsland } from '../../data/islands'
import type { Obstacle, Vec2 } from '../../data/life'
import Skyscraper from '../Skyscraper'
import Animals from './Animals'
import Avatar from './Avatar'
import Birds from './Birds'
import ConstructionSite from './ConstructionSite'
import Island from './Island'
import River from './River'
import Streets from './Streets'
import Traffic from './Traffic'

const MEMBER_COLORS = ['#2563eb', '#e0592a']

/** Footprint and crane height of the construction site model, for the birds to fly around. */
const CONSTRUCTION_SIZE: [number, number] = [2.8, 2.8]
const CONSTRUCTION_TOP = 4

function sidewalkLoop([cx, cz]: Vec2): Vec2[] {
  const half = BLOCK_SIZE / 2 + SIDEWALK_WIDTH / 2
  return [
    [cx - half, cz - half],
    [cx + half, cz - half],
    [cx + half, cz + half],
    [cx - half, cz + half],
  ]
}

type IslandSceneProps = {
  resolved: ResolvedIsland
  center: Vec2
  me: UserSummary
  presence: Record<string, PresenceStatus>
  storeyDelta: number
  onHouseClick: (topicId: string) => void
}

/** One island with its grid, houses, wildlife and the members of its learning group. */
export default function IslandScene({ resolved, center, me, presence, storeyDelta, onHouseClick }: IslandSceneProps) {
  const { island, houses, construction, fieldBlocks } = resolved

  // Members walk around a free cell. The one nearest the camera (largest x + z) can't be hidden
  // behind a house; ties go to the cell nearer the middle.
  const memberLoop = useMemo(() => {
    const front = [...fieldBlocks].sort(
      (a, b) =>
        b.center[0] + b.center[1] - (a.center[0] + a.center[1]) ||
        Math.hypot(...a.center) - Math.hypot(...b.center),
    )[0]
    return sidewalkLoop(front?.center ?? [0, 0])
  }, [fieldBlocks])

  const obstacles = useMemo(
    (): Obstacle[] => [
      ...houses.map((placed) => ({
        center: placed.position,
        size: placed.house.footprint,
        top: previewHeights(placed.house, storeyDelta).reduce((sum, height) => sum + height, 0),
      })),
      ...(construction ? [{ center: construction.position, size: CONSTRUCTION_SIZE, top: CONSTRUCTION_TOP }] : []),
    ],
    [houses, construction, storeyDelta],
  )

  return (
    <group position={[center[0], 0, center[1]]}>
      <Island />
      <Streets fieldBlocks={fieldBlocks} />
      <River />
      <Traffic />
      <Animals fieldBlocks={fieldBlocks} />
      <Birds fieldBlocks={fieldBlocks} obstacles={obstacles} />

      {houses.map((placed) => (
        <Skyscraper
          key={placed.topicId}
          house={placed.house}
          position={placed.position}
          storeyDelta={storeyDelta}
          onClick={() => onHouseClick(placed.topicId)}
        />
      ))}

      {construction && <ConstructionSite position={construction.position} />}

      {island.group.members.map((member, index) => (
        <Avatar
          key={member.id}
          name={member.name}
          color={MEMBER_COLORS[index % MEMBER_COLORS.length]}
          status={presence[member.id] ?? 'offline'}
          isSelf={member.id === me.id}
          loop={memberLoop}
          phase={index * 0.5 + 0.1}
        />
      ))}
    </group>
  )
}
