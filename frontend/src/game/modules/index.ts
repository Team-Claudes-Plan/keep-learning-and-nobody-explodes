import type { ModuleDef } from './types'
import WireModule from './WireModule'
import WireModule3D from './WireModule3D'
import FuseModule from './FuseModule'
import SwitchModule from './SwitchModule'
import RotaryModule from './RotaryModule'
import RotaryModule3D from './RotaryModule3D'
import CableModule from './CableModule'
import CableModule3D from './CableModule3D'
import SorterModule from './SorterModule'
import LockModule from './LockModule'
import TerminalModule from './TerminalModule'
import TerminalModule3D from './TerminalModule3D'
import ButtonsModule from './ButtonsModule'
import SliderModule from './SliderModule'
import RadarModule from './RadarModule'

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
  },
  {
    id: 'switches',
    name: 'Schalter umlegen',
    icon: '🎚️',
    description: 'Multiple Choice, Wahr/Falsch, Gruppieren',
    supports: (p, type) =>
      (p.kind === 'pick' && p.mode === 'many' && p.selects !== 'false') ||
      (p.kind === 'assign' && type !== 'matching' && p.targets.length <= 4),
    component: SwitchModule as Component,
  },
  {
    id: 'rotary',
    name: 'Drehschalter',
    icon: '🎛️',
    description: 'Single Choice, Wahr/Falsch, Gruppieren',
    supports: (p, type) =>
      (p.kind === 'pick' && p.mode === 'one') || (p.kind === 'assign' && type !== 'matching' && p.targets.length <= 8),
    confirm: true,
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
    component: SorterModule as Component,
  },
  {
    id: 'lock',
    name: 'Zahlenschloss',
    icon: '🔢',
    description: 'Zahleneingabe (0–9999)',
    supports: (p) => p.kind === 'number',
    init: () => 0,
    component: LockModule as Component,
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
  },
  {
    id: 'slider',
    name: 'Schiebe-Rätsel',
    icon: '↔️',
    description: 'Reihenfolge',
    supports: (p) => p.kind === 'sequence',
    init: (p) => (p.kind === 'sequence' ? p.items.map((_, i) => i) : []),
    component: SliderModule as Component,
  },
  {
    id: 'radar',
    name: 'Radar',
    icon: '🎯',
    description: 'Koordinaten',
    supports: (p) => p.kind === 'point',
    component: RadarModule as Component,
  },
]

export function getModule(id: string | undefined): ModuleDef | undefined {
  return MODULES.find((m) => m.id === id)
}
