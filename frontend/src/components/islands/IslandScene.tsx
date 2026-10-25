import { useMemo } from 'react'
import type { PresenceStatus, UserSummary } from '../../api/types'
import { BLOCK_SIZE, SIDEWALK_WIDTH } from '../../data/islandGrid'
import type { ResolvedIsland } from '../../data/islands'
import type { Vec2 } from '../../data/life'
import Skyscraper from '../Skyscraper'
import Animals from './Animals'
import Avatar from './Avatar'
import Birds from './Birds'
import Island from './Island'
import River from './River'
import Streets from './Streets'
import Traffic from './Traffic'

const MEMBER_COLORS = ['#2563eb', '#e0592a']

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
  onHouseClick: (houseId: string) => void
}

/** One island with its grid, houses, wildlife and the members of its learning group. */
export default function IslandScene({ resolved, center, me, presence, storeyDelta, onHouseClick }: IslandSceneProps) {
  const { island, houses, fieldBlocks } = resolved

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

  return (
    <group position={[center[0], 0, center[1]]}>
      <Island />
      <Streets fieldBlocks={fieldBlocks} />
      <River />
      <Traffic />
      <Animals fieldBlocks={fieldBlocks} />
      <Birds fieldBlocks={fieldBlocks} />

      {houses.map((placed) => (
        <Skyscraper
          key={placed.house.id}
          house={placed.house}
          position={placed.position}
          storeyDelta={storeyDelta}
          onClick={onHouseClick}
        />
      ))}

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
