import type { ComponentType } from 'react'
import type { QuestionType } from '../../api/types'
import type { AnyValue, Primitive, PrimitiveKind, PrimitiveOf, ValueOf } from '../primitives'

/** Modules are controlled: the bomb holds the value and submits it on "Abschließen". */
export type ModuleProps<K extends PrimitiveKind> = {
  primitive: PrimitiveOf<K>
  value: ValueOf<K>
  onChange: (value: ValueOf<K>) => void
  disabled: boolean
  /** Submit the current value, e.g. on Enter. No-op while incomplete. */
  onLockIn: () => void
}

export type ModuleDef = {
  id: string
  name: string
  icon: string
  description: string
  supports: (primitive: Primitive, questionType: QuestionType) => boolean
  /** Single choice normally submits on the first selection; true keeps the "Abschließen" button. */
  confirm?: boolean
  /** Starting value if the module needs a different one than the primitive default. */
  init?: (primitive: Primitive) => AnyValue
  component: ComponentType<ModuleProps<PrimitiveKind>>
}
