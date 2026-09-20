// Per-role sidebars in the pilot app's shape: items, groups of items, and section dividers.

const SQUAD_GROUP = {
  kind: 'group',
  id: 'squad',
  label: 'nav.squad',
  items: [{ id: 'squad-overview', label: 'nav.overview', route: '/squad' }],
}

const TRAINING_GROUP = {
  kind: 'group',
  id: 'training',
  label: 'nav.training',
  items: [{ id: 'training-overview', label: 'nav.overview', route: '/training' }],
}

export const COACH_NAV = [
  { kind: 'item', id: 'dashboard', label: 'nav.dashboard', route: '/dashboard' },
  SQUAD_GROUP,
  TRAINING_GROUP,
]

export const PLAYER_NAV = [
  { kind: 'item', id: 'home', label: 'nav.dashboard', route: '/my' },
  { kind: 'item', id: 'my-medical', label: 'nav.medicalStatus', route: '/my/medical' },
]

export const PARENT_NAV = [
  { kind: 'item', id: 'home', label: 'nav.dashboard', route: '/my' },
  { kind: 'section', id: 'family', label: 'nav.sections.family' },
  { kind: 'item', id: 'my-children', label: 'nav.myChildren', route: '/my/children' },
  { kind: 'item', id: 'my-children-medical', label: 'nav.medicalStatus', route: '/my/children/medical' },
]
