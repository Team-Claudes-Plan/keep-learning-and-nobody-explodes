// Interaction shapes that modules implement. Adapters translate questions
// into these, so one module can serve several question types.

/** Choose one or several of the items. Value: selected item indices. */
export type PickPrimitive = {
  kind: 'pick'
  mode: 'one' | 'many'
  items: string[]
  /** Labels for the selected/unselected state, e.g. WAHR / FALSCH. */
  onLabel?: string
  offLabel?: string
  /** For multiple choice / true-false: whether the selected items are the correct or the wrong ones. */
  selects?: 'true' | 'false'
}

/** Assign every item to one target. Value: target index per item (null = unassigned). */
export type AssignPrimitive = {
  kind: 'assign'
  items: string[]
  targets: string[]
  /** Each target may be used at most once (matching). */
  unique?: boolean
}

/** Enter a number. Value: the number, or null if nothing entered yet. */
export type NumberPrimitive = {
  kind: 'number'
  unit?: string | null
}

/** Enter free text. Value: the text. */
export type TextPrimitive = {
  kind: 'text'
  /** Case does not matter, so input is shown and sent in upper case. */
  uppercase?: boolean
  /** Koop: account the terminal is logged in as; the manual lists the question per user. */
  user?: string
}

/** Arrange all items in an order. Value: item indices in the chosen order. */
export type SequencePrimitive = {
  kind: 'sequence'
  items: string[]
}

/** Pick a point on an image. Value: position in percent, or null. */
export type PointPrimitive = {
  kind: 'point'
  image: string
}

export type Primitive =
  | PickPrimitive
  | AssignPrimitive
  | NumberPrimitive
  | TextPrimitive
  | SequencePrimitive
  | PointPrimitive
export type PrimitiveKind = Primitive['kind']
export type PrimitiveOf<K extends PrimitiveKind> = Extract<Primitive, { kind: K }>

export type Point = { x: number; y: number }

export type ValueMap = {
  pick: number[]
  assign: (number | null)[]
  number: number | null
  text: string
  sequence: number[]
  point: Point | null
}
export type ValueOf<K extends PrimitiveKind> = ValueMap[K]
export type AnyValue = ValueMap[PrimitiveKind]

/** Default starting value; modules may override it via ModuleDef.init. */
export function initialValue(primitive: Primitive): AnyValue {
  switch (primitive.kind) {
    case 'pick':
      return []
    case 'assign':
      return primitive.items.map(() => null)
    case 'number':
      return null
    case 'text':
      return ''
    case 'sequence':
      return []
    case 'point':
      return null
  }
}

/** Single choice is final on the first selection, so it is sent without "Abschließen". */
export function submitsImmediately(primitive: Primitive): boolean {
  return primitive.kind === 'pick' && primitive.mode === 'one'
}

/** Whether the value is a valid answer the player may submit. */
export function isComplete(primitive: Primitive, value: AnyValue): boolean {
  switch (primitive.kind) {
    case 'pick':
      return primitive.mode === 'many' || (value as number[]).length === 1
    case 'assign':
      return (value as (number | null)[]).every((v) => v !== null)
    case 'number':
      return value !== null
    case 'text':
      return (value as string).trim().length > 0
    case 'sequence':
      return (value as number[]).length === primitive.items.length
    case 'point':
      return value !== null
  }
}
