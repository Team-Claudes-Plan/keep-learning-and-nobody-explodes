import type { FacadeConfig } from './facadeTypes'
import type { HouseParts } from './houseParts'
import { houseBlockCenter } from './city'
import type { HouseKitId } from './houseKits'

export type Room = {
  floorColor: string
  wallColor: string
}

export type Storey = {
  id: string
  label: string
  height: number
  concept?: string
  parts?: Partial<HouseParts>
  room: Room
}

export type House = {
  id: string
  name: string
  facadeColor: string
  decorColor?: string
  facade: FacadeConfig
  /** Stackable 3D model for the city view; houses without one fall back to the textured facade. */
  kit?: HouseKitId
  parts?: Partial<HouseParts>
  footprint: [number, number]
  position: [number, number]
  storeys: Storey[]
}

export const HOUSES: House[] = [
  {
    id: 'house-a',
    name: 'Geography',
    facadeColor: '#4f8cff',
    kit: 'geography',
    facade: { shape: 'tiered-setback', design: 'glass-grid', textures: 'house-a' },
    footprint: [2.4, 2.4],
    position: houseBlockCenter('house-a'),
    storeys: [
      { id: 'ground', label: 'Ground floor', height: 1.6, concept: 'foundations', room: { floorColor: '#2b3550', wallColor: '#3d4a6b' } },
      { id: 'first', label: 'First floor', height: 1.4, concept: 'patterns', room: { floorColor: '#2b3550', wallColor: '#3d4a6b' } },
      { id: 'second', label: 'Second floor', height: 1.4, concept: 'structures', room: { floorColor: '#2b3550', wallColor: '#3d4a6b' } },
    ],
  },
  {
    id: 'house-b',
    name: 'Robotics',
    facadeColor: '#ff8f4f',
    kit: 'robotics',
    facade: { shape: 'spire', design: 'panel', textures: 'house-b' },
    footprint: [2.8, 2.2],
    position: houseBlockCenter('house-b'),
    storeys: [
      { id: 'ground', label: 'Ground floor', height: 1.8, concept: 'foundations', room: { floorColor: '#3a2f24', wallColor: '#5a4a38' } },
      { id: 'first', label: 'First floor', height: 1.5, concept: 'networks', room: { floorColor: '#3a2f24', wallColor: '#5a4a38' } },
    ],
  },
  {
    id: 'house-c',
    name: 'Biology',
    facadeColor: '#4fd18b',
    kit: 'biology',
    facade: { shape: 'tree-tower', design: 'organic-bark', textures: 'house-c' },
    footprint: [2.2, 2.8],
    position: houseBlockCenter('house-c'),
    storeys: [
      { id: 'ground', label: 'Ground floor', height: 1.7, concept: 'structures', room: { floorColor: '#24332a', wallColor: '#38604a' } },
      { id: 'first', label: 'First floor', height: 1.5, concept: 'analysis', room: { floorColor: '#24332a', wallColor: '#38604a' } },
      { id: 'second', label: 'Second floor', height: 1.5, concept: 'patterns', room: { floorColor: '#24332a', wallColor: '#38604a' } },
      { id: 'third', label: 'Attic', height: 1.2, concept: 'systems', room: { floorColor: '#24332a', wallColor: '#38604a' } },
    ],
  },
  {
    id: 'house-math-tower',
    name: 'Mathematics',
    facadeColor: '#2d5e9f',
    kit: 'math',
    facade: { shape: 'penthouse', design: 'house-math-tower', textures: 'house-math-tower', roofColor: '#263550' },
    footprint: [2.4, 2.4],
    position: houseBlockCenter('house-math-tower'),
    storeys: [
      { id: 'ground', label: 'Ground floor', height: 1.8, concept: 'foundations', room: { floorColor: '#1f2d4a', wallColor: '#2d5e9f' } },
      { id: 'first', label: 'First floor', height: 1.6, concept: 'patterns', room: { floorColor: '#1f2d4a', wallColor: '#2d5e9f' } },
      { id: 'second', label: 'Second floor', height: 1.6, concept: 'structures', room: { floorColor: '#1f2d4a', wallColor: '#2d5e9f' } },
      { id: 'third', label: 'Observatory', height: 1.4, concept: 'analysis', room: { floorColor: '#1f2d4a', wallColor: '#2d5e9f' } },
    ],
  },
]

export function getHouse(houseId: string): House | undefined {
  return HOUSES.find((house) => house.id === houseId)
}

export function getStorey(houseId: string, storeyId: string): Storey | undefined {
  return getHouse(houseId)?.storeys.find((storey) => storey.id === storeyId)
}

export function houseHeight(house: House): number {
  return house.storeys.reduce((total, storey) => total + storey.height, 0)
}
