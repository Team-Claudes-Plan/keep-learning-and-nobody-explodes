/**
 * Stackable low-poly house models, one per topic. Built in Blender by
 * scripts/blender/houses.py. Each GLB holds three modules:
 * - base: ground storey with the entrance
 * - middle: one storey, repeated for every storey above the ground floor
 * - top: roof crown with the topic's landmark
 * Moving parts (math plot, globe, robot arms and eyes, rooftop tree) are child nodes tagged with
 * an `anim` extra; KitFacade animates them.
 */
export type HouseKitId = 'math' | 'biology' | 'robotics' | 'geography'

export type HouseKit = {
  id: HouseKitId
  label: string
  url: string
  /** House view: colour of the cut edges (floor slabs and wall ends) so they match the shell. */
  trim: string
  /**
   * House view only: how far the rooms' open front sits behind the kit's front face, as a
   * share of the kit's depth, so features that only exist at the front (biology's notch) are cut off.
   */
  frontRecess?: number
}

export const HOUSE_KITS: Record<HouseKitId, HouseKit> = {
  math: { id: 'math', label: 'Mathematics', url: '/models/houses/math.glb', trim: '#efe6d2' },
  biology: { id: 'biology', label: 'Biology', url: '/models/houses/biology.glb', trim: '#f4f7f2', frontRecess: 0.8 / 2.8 },
  robotics: { id: 'robotics', label: 'Robotics', url: '/models/houses/robotics.glb', trim: '#55607a' },
  geography: { id: 'geography', label: 'Geography', url: '/models/houses/geography.glb', trim: '#8c8378' },
}

/** Storey height to use when previewing storeys a house doesn't have yet. */
export const KIT_MIDDLE_HEIGHT = 1.5
