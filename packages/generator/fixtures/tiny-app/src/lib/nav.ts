import { ROUTE_ROLES } from './permissions'

export const DEEP_LINKS = [
  {
    path: '/squad',
    roles: ROUTE_ROLES.squadOverview,
    reason: 'Off-nav for ADMIN; reachable from the club header',
    palette: { id: 'off-squad', label: 'nav.squad', icon: 'users' },
  },
  {
    path: '/squad/teams',
    roles: ROUTE_ROLES.squadOverview,
    reason: 'Legacy team list — /squad/players is the canonical roster',
  },
]

export const NAV = [
  { id: 'squad', label: 'nav.squad', route: '/squad' },
  { id: 'players', label: 'nav.players', route: '/squad/players' },
  { id: 'settings', label: 'nav.settings', route: '/settings' },
]
