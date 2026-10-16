// A pack's own role lists, built from the app's: read through the import, as a route table's pack lists are.
import { CAPABILITY_ROLES } from '../permissions'

export const PACK_ROLES = {
  matches: [...CAPABILITY_ROLES.sessionsManage],
}
