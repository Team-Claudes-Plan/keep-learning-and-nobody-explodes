import type { FacadeConfig } from './facadeTypes'
import { houseBlockCenter } from './city'

export type RoomItem = {
  id: string
  label: string
  position: [number, number, number]
  color: string
}

export type Room = {
  floorColor: string
  wallColor: string
  items: RoomItem[]
}

export type Storey = {
  id: string
  label: string
  height: number
  room: Room
}

export type House = {
  id: string
  name: string
  facadeColor: string
  facade: FacadeConfig
  footprint: [number, number]
  position: [number, number]
  storeys: Storey[]
}

const livingRoomItems: RoomItem[] = [
  { id: 'sofa', label: 'Sofa', position: [-0.9, 0.25, 0.4], color: '#8f6bff' },
  { id: 'table', label: 'Coffee table', position: [0, 0.2, -0.2], color: '#4fd18b' },
  { id: 'tv', label: 'TV', position: [0.9, 0.35, -0.6], color: '#4f8cff' },
]

const kitchenItems: RoomItem[] = [
  { id: 'counter', label: 'Counter', position: [-0.7, 0.35, 0.6], color: '#ffb347' },
  { id: 'fridge', label: 'Fridge', position: [0.8, 0.6, 0.5], color: '#4fd1d1' },
  { id: 'stove', label: 'Stove', position: [0.1, 0.3, 0.6], color: '#ff5f6d' },
]

const bedroomItems: RoomItem[] = [
  { id: 'bed', label: 'Bed', position: [-0.7, 0.3, 0.3], color: '#4f8cff' },
  { id: 'wardrobe', label: 'Wardrobe', position: [0.8, 0.7, 0.2], color: '#c98b5a' },
  { id: 'desk', label: 'Desk', position: [0.4, 0.3, -0.8], color: '#4fd18b' },
]

const studyItems: RoomItem[] = [
  { id: 'bookshelf', label: 'Bookshelf', position: [-0.8, 0.7, 0.5], color: '#c98b5a' },
  { id: 'desk', label: 'Desk', position: [0.2, 0.3, -0.6], color: '#8f6bff' },
  { id: 'chair', label: 'Chair', position: [0.8, 0.25, 0.2], color: '#ff8f4f' },
]

export const HOUSES: House[] = [
  {
    id: 'house-a',
    name: 'House A',
    facadeColor: '#4f8cff',
    facade: { shape: 'tiered-setback', design: 'glass-grid', textures: 'house-a' },
    footprint: [2.4, 2.4],
    position: houseBlockCenter('house-a'),
    storeys: [
      { id: 'ground', label: 'Ground floor', height: 1.6, room: { floorColor: '#2b3550', wallColor: '#3d4a6b', items: livingRoomItems } },
      { id: 'first', label: 'First floor', height: 1.4, room: { floorColor: '#2b3550', wallColor: '#3d4a6b', items: kitchenItems } },
      { id: 'second', label: 'Second floor', height: 1.4, room: { floorColor: '#2b3550', wallColor: '#3d4a6b', items: bedroomItems } },
    ],
  },
  {
    id: 'house-b',
    name: 'House B',
    facadeColor: '#ff8f4f',
    facade: { shape: 'spire', design: 'panel', textures: 'house-b' },
    footprint: [2.8, 2.2],
    position: houseBlockCenter('house-b'),
    storeys: [
      { id: 'ground', label: 'Ground floor', height: 1.8, room: { floorColor: '#3a2f24', wallColor: '#5a4a38', items: livingRoomItems } },
      { id: 'first', label: 'First floor', height: 1.5, room: { floorColor: '#3a2f24', wallColor: '#5a4a38', items: studyItems } },
    ],
  },
  {
    id: 'house-c',
    name: 'House C',
    facadeColor: '#4fd18b',
    facade: { shape: 'tree-tower', design: 'organic-bark', textures: 'house-c' },
    footprint: [2.2, 2.8],
    position: houseBlockCenter('house-c'),
    storeys: [
      { id: 'ground', label: 'Ground floor', height: 1.7, room: { floorColor: '#24332a', wallColor: '#38604a', items: kitchenItems } },
      { id: 'first', label: 'First floor', height: 1.5, room: { floorColor: '#24332a', wallColor: '#38604a', items: bedroomItems } },
      { id: 'second', label: 'Second floor', height: 1.5, room: { floorColor: '#24332a', wallColor: '#38604a', items: studyItems } },
      { id: 'third', label: 'Attic', height: 1.2, room: { floorColor: '#24332a', wallColor: '#38604a', items: livingRoomItems } },
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
