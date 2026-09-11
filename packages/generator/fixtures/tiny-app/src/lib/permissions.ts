// Fixture application for the generator's tests. Not compiled, not shipped —
// read as source text, which is exactly what an adopter's code is to us.

export type BackendRole = 'ADMIN' | 'COACH' | 'PARENT'

export const APP_ROLES: BackendRole[] = ['ADMIN', 'COACH', 'PARENT']

const readRoles = (...roles: BackendRole[]): BackendRole[] => [...roles]

// Not an identity helper: it removes a role. A generator that reads any call's
// string arguments as "the roles" would grant exactly the role this revokes.
const exceptRole = (role: BackendRole): BackendRole[] => APP_ROLES.filter((r) => r !== role)

export const ROUTE_ROLES = {
  squadOverview: readRoles('COACH', 'ADMIN'),
  squadPlayers: ['COACH'] as BackendRole[],
  adminOnly: readRoles('ADMIN'),
  everyone: APP_ROLES,
  parentSelf: readRoles('PARENT'),
  notForParents: exceptRole('PARENT'),
}
