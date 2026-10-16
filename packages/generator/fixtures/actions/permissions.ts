// The fixture's permissions module: who may do what, as role lists a page can name (ADR-042).
export const APP_ROLES = ['ADMIN', 'COACH', 'PARENT']

export const CAPABILITY_ROLES = {
  sessionsManage: ['ADMIN', 'COACH'],
  budget: ['ADMIN'],
}

export const LOCALES = ['pt', 'en']

export function hasCapability(roles: readonly string[], ...allowed: string[]): boolean {
  return roles.some((role) => allowed.includes(role))
}

export function hasRole(role: string): boolean {
  return currentRoles().includes(role)
}

declare function currentRoles(): string[]
