// Per-role sidebars in the shape real apps use: items, groups of items, and section dividers.

const CLASSES_GROUP = {
  kind: 'group',
  id: 'classes',
  label: 'nav.classes',
  items: [{ id: 'classes-overview', label: 'nav.overview', route: '/classes' }],
}

const LESSONS_GROUP = {
  kind: 'group',
  id: 'lessons',
  label: 'nav.lessons',
  items: [{ id: 'lessons-overview', label: 'nav.overview', route: '/lessons' }],
}

export const TEACHER_NAV = [
  { kind: 'item', id: 'dashboard', label: 'nav.dashboard', route: '/dashboard' },
  CLASSES_GROUP,
  LESSONS_GROUP,
]

export const STUDENT_NAV = [
  { kind: 'item', id: 'home', label: 'nav.dashboard', route: '/my' },
  { kind: 'item', id: 'my-grades', label: 'nav.grades', route: '/my/grades' },
]

export const PARENT_NAV = [
  { kind: 'item', id: 'home', label: 'nav.dashboard', route: '/my' },
  { kind: 'section', id: 'family', label: 'nav.sections.family' },
  { kind: 'item', id: 'my-children', label: 'nav.myChildren', route: '/my/children' },
  { kind: 'item', id: 'my-children-grades', label: 'nav.grades', route: '/my/children/grades' },
]
