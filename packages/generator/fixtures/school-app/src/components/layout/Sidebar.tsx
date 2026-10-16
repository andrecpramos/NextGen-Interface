import { SidebarItem } from './SidebarItem'

/** The sidebar's pinned items, written inline rather than in a nav config. */
export default function SidebarFooter() {
  return (
    <SidebarItem
      item={{
        kind: 'item',
        id: 'config',
        label: 'nav.settings',
        route: '/settings',
      }}
    />
  )
}
