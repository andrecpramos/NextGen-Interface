// Fixture application for the generator's tests. Not compiled, not shipped —
// read as source text, which is exactly what an adopter's code is to us.

export type BackendRole = 'COACH' | 'PLAYER' | 'PARENT'

export const APP_ROLES: BackendRole[] = ['COACH', 'PLAYER', 'PARENT']

const readRoles = (...roles: BackendRole[]): BackendRole[] => [...roles]

export const ROUTE_ROLES = {
  everyone: APP_ROLES,
  staff: readRoles('COACH'),
  myHome: readRoles('PLAYER', 'PARENT'),
  playerSelf: readRoles('PLAYER'),
  parentSelf: readRoles('PARENT'),
}
