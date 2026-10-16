// Fixture application for the generator's tests. Not compiled, not shipped —
// read as source text, which is exactly what an adopter's code is to us.

export type BackendRole = 'TEACHER' | 'STUDENT' | 'PARENT'

export const APP_ROLES: BackendRole[] = ['TEACHER', 'STUDENT', 'PARENT']

const readRoles = (...roles: BackendRole[]): BackendRole[] => [...roles]

export const ROUTE_ROLES = {
  everyone: APP_ROLES,
  staff: readRoles('TEACHER'),
  myHome: readRoles('STUDENT', 'PARENT'),
  studentSelf: readRoles('STUDENT'),
  parentSelf: readRoles('PARENT'),
}
