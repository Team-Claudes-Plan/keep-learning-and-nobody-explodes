export type Walls = {
  front: boolean
  back: boolean
  left: boolean
  right: boolean
  ceiling: boolean
}

export const ALL_WALLS: Walls = { front: true, back: true, left: true, right: true, ceiling: true }
export const NO_FRONT: Walls = { front: false, back: true, left: true, right: true, ceiling: false }
export const NO_FRONT_RIGHT: Walls = { front: false, back: true, left: true, right: false, ceiling: false }
