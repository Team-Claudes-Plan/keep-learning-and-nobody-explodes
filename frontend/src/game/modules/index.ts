import { initialValue } from '../primitives'
import type { ModuleDef } from './types'
import WireModule from './WireModule'
import WireModule3D from './WireModule3D'
import FuseModule from './FuseModule'
import FuseModule3D from './FuseModule3D'
import SwitchModule from './SwitchModule'
import SwitchModule3D from './SwitchModule3D'
import RotaryModule from './RotaryModule'
import RotaryModule3D from './RotaryModule3D'
import CableModule from './CableModule'
import CableModule3D from './CableModule3D'
import SorterModule from './SorterModule'
import SorterModule3D from './SorterModule3D'
import LockModule from './LockModule'
import LockModule3D from './LockModule3D'
import TerminalModule from './TerminalModule'
import TerminalModule3D from './TerminalModule3D'
import ButtonsModule from './ButtonsModule'
import ButtonsModule3D from './ButtonsModule3D'
import SliderModule from './SliderModule'
import SliderModule3D from './SliderModule3D'
import RadarModule from './RadarModule'
import RadarModule3D from './RadarModule3D'

type Component = ModuleDef['component']

// To add a module: implement ModuleProps for one or more primitives and register it here.
export const MODULES: ModuleDef[] = [
  {
    id: 'wires',
    name: 'Kabel durchschneiden',
    icon: '✂️',
    description: 'Single Choice, Multiple Choice, Wahr/Falsch',
    // Multiple choice / true-false: the wrong options get cut.
    supports: (p) => p.kind === 'pick' && p.selects !== 'true' && p.items.length <= 8,
    component: WireModule as Component,
    component3d: WireModule3D as Component,
  },
  {
    id: 'fuses',
    name: 'Sicherungskasten',
    icon: '🔌',
    description: 'Single Choice, Multiple Choice, Wahr/Falsch',
    supports: (p) => p.kind === 'pick' && p.selects !== 'false' && p.items.length <= 8,
    component: FuseModule as Component,
    component3d: FuseModule3D as Component,
  },
  {
    id: 'switches',
    name: 'Schalter umlegen',
    icon: '🎚️',
    description: 'Multiple Choice, Wahr/Falsch, Gruppieren',
    supports: (p, type) =>
      (p.kind === 'pick' && p.mode === 'many' && p.selects !== 'false') ||
      (p.kind === 'assign' && type !== 'matching' && p.targets.length <= 4),
    // Slide switches start in the first column (counts as chosen), so it can be locked in straight away.
    init: (p) => (p.kind === 'assign' ? p.items.map(() => 0) : initialValue(p)),
    component: SwitchModule as Component,
    component3d: SwitchModule3D as Component,
  },
  {
    id: 'rotary',
    name: 'Drehschalter',
    icon: '🎛️',
    description: 'Single Choice, Wahr/Falsch, Gruppieren',
    supports: (p, type) =>
      (p.kind === 'pick' && p.mode === 'one') || (p.kind === 'assign' && type !== 'matching' && p.targets.length <= 8),
    confirm: true,
    // The dial already points at the first answer when opened, so that counts as chosen: it can be
    // locked in straight away. Item by item (true/false, grouping) an item counts once it has been
    // shown on the dial (see RotaryModule3D), so all of them have to be looked at before locking in.
    init: (p) => (p.kind === 'pick' ? [0] : initialValue(p)),
    component: RotaryModule as Component,
    component3d: RotaryModule3D as Component,
  },
  {
    id: 'cables',
    name: 'Kabel verbinden',
    icon: '🔗',
    description: 'Zuordnen, Gruppieren',
    supports: (p, type) => p.kind === 'assign' && (type === 'matching' || type === 'grouping'),
    component: CableModule as Component,
    component3d: CableModule3D as Component,
  },
  {
    id: 'sorter',
    name: 'Sortier-Weiche',
    icon: '🗂️',
    description: 'Gruppieren, Wahr/Falsch',
    supports: (p) => p.kind === 'assign' && !p.unique && p.targets.length <= 4,
    // the last part sorted off the belt finishes it
    submitWhenComplete: true,
    component: SorterModule as Component,
    component3d: SorterModule3D as Component,
  },
  {
    id: 'lock',
    name: 'Zahlenschloss',
    icon: '🔢',
    description: 'Zahleneingabe (0–9999)',
    supports: (p) => p.kind === 'number',
    init: () => 0,
    component: LockModule as Component,
    component3d: LockModule3D as Component,
  },
  {
    id: 'terminal',
    name: 'Terminal',
    icon: '⌨️',
    description: 'Texteingabe, Zahleneingabe',
    supports: (p) => p.kind === 'text' || p.kind === 'number',
    component: TerminalModule as Component,
    component3d: TerminalModule3D as Component,
  },
  {
    id: 'buttons',
    name: 'Knöpfe drücken',
    icon: '🔴',
    description: 'Reihenfolge',
    supports: (p) => p.kind === 'sequence',
    component: ButtonsModule as Component,
    component3d: ButtonsModule3D as Component,
  },
  {
    id: 'slider',
    name: 'Schiebe-Rätsel',
    icon: '↔️',
    description: 'Reihenfolge',
    supports: (p) => p.kind === 'sequence',
    init: (p) => (p.kind === 'sequence' ? p.items.map((_, i) => i) : []),
    component: SliderModule as Component,
    component3d: SliderModule3D as Component,
  },
  {
    id: 'radar',
    name: 'Radar',
    icon: '🎯',
    description: 'Koordinaten',
    supports: (p) => p.kind === 'point',
    component: RadarModule as Component,
    component3d: RadarModule3D as Component,
  },
]

export function getModule(id: string | undefined): ModuleDef | undefined {
  return MODULES.find((m) => m.id === id)
}
