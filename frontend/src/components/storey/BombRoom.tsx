import { Suspense } from 'react'
import SceneCanvas from '../SceneCanvas'
import { ROOM_CAMERA, roomZoom } from '../cameras'
import RoomStage from '../RoomStage'
import { useWallTextures } from '../facade/useHouseTextures'
import type { SurfaceSpec } from '../surfaces'
import BombTable, { BOMB_SPOT, TABLE_HALF_SIZE, TABLE_TOP } from './BombTable'
import RoomBomb, { type RoomBombProps } from './RoomBomb'
import RoomDecor from './RoomDecor'
import type { House, Room, Storey } from '../../data/houses'
import { DEFAULT_WALL_ATLAS, resolveParts } from '../../data/houseParts'
import { resolveDesign } from '../../data/baseDesigns'

/** Front and centre of the room, in front of the furniture. */
const BOMB_TABLE_POSITION: [number, number, number] = [0, 0, 4]
const BOMB_REST: [number, number, number] = [
  BOMB_TABLE_POSITION[0] + BOMB_SPOT[0],
  BOMB_TABLE_POSITION[1] + BOMB_SPOT[1],
  BOMB_TABLE_POSITION[2] + BOMB_SPOT[2],
]

/** Pieces of a blown-up bomb land on the table top, or on the floor around it. */
function floorAt(x: number, z: number) {
  const onTable =
    Math.abs(x - BOMB_TABLE_POSITION[0]) <= TABLE_HALF_SIZE[0] && Math.abs(z - BOMB_TABLE_POSITION[2]) <= TABLE_HALF_SIZE[1]
  return onTable ? BOMB_TABLE_POSITION[1] + TABLE_TOP : 0
}

/** A room without a house (e.g. a lobby game). */
export const PLAIN_ROOM: Room = { floorColor: '#2b3550', wallColor: '#3d4a6b' }

export type BombRoomProps = Omit<RoomBombProps, 'rest' | 'floorAt'> & {
  room: Room
  wallSurface?: SurfaceSpec
}

/** A room with the bomb lying on a workbench; click it to pick it up. */
export default function BombRoom({ room, wallSurface, ...bomb }: BombRoomProps) {
  return (
    <SceneCanvas
      camera={{
        position: ROOM_CAMERA.position,
        rotation: ROOM_CAMERA.rotation,
        zoom: roomZoom({ width: window.innerWidth, height: window.innerHeight }),
        // orthographic: zoomed out on narrow screens, the floor reaches below the camera
        near: -20,
        far: 200,
      }}
      controls={false}
      grid={false}
      responsiveZoom={false}
    >
      <RoomStage wallColor={room.wallColor} floorColor={room.floorColor} wallSurface={wallSurface} />
      <RoomDecor />
      <BombTable position={BOMB_TABLE_POSITION} />
      <Suspense fallback={null}>
        <RoomBomb rest={BOMB_REST} floorAt={floorAt} {...bomb} />
      </Suspense>
    </SceneCanvas>
  )
}

/** The room of a house's storey, with the house's inner walls. Suspends while the wall textures load. */
export function StoreyBombRoom({ house, storey, ...props }: Omit<BombRoomProps, 'room' | 'wallSurface'> & { house: House; storey: Storey }) {
  const design = resolveDesign(house.facade.design)
  const atlas = house.facade.atlas ?? DEFAULT_WALL_ATLAS
  const wall = useWallTextures(house.facade.textures, design, atlas)
  const parts = resolveParts({ ...house.parts, ...storey.parts }, design.material.tint)

  const wallSurface: SurfaceSpec = {
    textures: wall.inner,
    color: parts.inner,
    emissive: '#000000',
    emissiveIntensity: 0,
    roughness: design.material.roughness,
    metalness: design.material.metalness,
    tileWidth: design.tiling.tileWidth,
    tileHeight: design.tiling.tileHeight,
  }

  return <BombRoom room={storey.room} wallSurface={wallSurface} {...props} />
}
