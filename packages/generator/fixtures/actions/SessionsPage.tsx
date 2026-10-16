// ADR-042: controls that do something, read from the page and from the application's own components it
// renders, and who may use each. Read by `controls.test.ts` alone — this page belongs to no fixture app,
// so no registry or golden decision moves.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { AlertDialogTrigger, Button, Can, DropdownMenuItem } from '@/components/ui'
import {
  archiveSession, cancelSession, duplicateSession, excuse, lock, notifyParents, planWeek, publishPlan, removeSession, reorder, save,
} from '../api'
import AdminTools from './AdminTools'
import ManagerPanel from './ManagerPanel'
import { PACK_ROLES } from './pack/permissions'
import { CAPABILITY_ROLES, hasCapability, hasRole, LOCALES } from './permissions'
import SessionToolbar from './SessionToolbar'

export default function SessionsPage({ id }: { id: string }) {
  const { t } = useTranslation('sessions')
  const { t: tc } = useTranslation('common')
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('week')
  const { canDelete, canEdit, canManage, role, user } = usePermissions()
  const canPlan = hasCapability(user?.roles ?? [], ...CAPABILITY_ROLES.sessionsManage)

  const handlePublish = () => publishPlan(id)

  return (
    <form onSubmit={(e) => { e.preventDefault(); save() }}>
      {/* Does something, for everyone who can open the screen. */}
      <Button onClick={() => cancelSession(id)}>{t('actions.cancel_session')}</Button>
      <Button onClick={handlePublish}>Publish plan</Button>
      <DropdownMenuItem onSelect={() => duplicateSession(id)}>Duplicate session</DropdownMenuItem>
      <AlertDialogTrigger>Remove all sessions</AlertDialogTrigger>
      <Button type="submit">{tc('save_changes')}</Button>

      {/* Opens something: an opener, not an action. */}
      <Button onClick={() => setOpen(true)}>New session</Button>

      {/* Chrome: moves, switches a view, closes, or names no task. */}
      <Button onClick={() => navigate('/training')}>Back to training</Button>
      <Button onClick={() => setTab('month')}>Month</Button>
      <Button onClick={() => setOpen(false)}>Close</Button>
      <Button onClick={() => cancelSession(id)}>Cancel</Button>
      <Button onClick={() => save()}>OK</Button>
      <Button onClick={() => save()}>{`Save ${tab}`}</Button>

      {/* For some roles, by the permissions module's own lists and role names. */}
      {role === 'ADMIN' ? <Button onClick={() => archiveSession(id)}>Archive season</Button> : null}
      {tab === 'week' && canPlan && <Button onClick={() => planWeek()}>Plan the week</Button>}
      {hasRole('PARENT') ? <Button onClick={() => excuse()}>Excuse an absence</Button> : null}
      {!hasRole('PARENT') && <Button onClick={() => notifyParents()}>Notify parents</Button>}
      {hasCapability(user?.roles ?? [], ...PACK_ROLES.matches) && <Button onClick={() => scheduleMatch()}>Schedule a match</Button>}

      {/* For some people nobody can name from the source: never listed, whatever the condition means. */}
      {canDelete && <Button onClick={() => removeSession(id)}>Delete session</Button>}
      <Can perform="sessions.lock"><Button onClick={() => lock(id)}>Lock session</Button></Can>
      <Button disabled={!canEdit} onClick={() => reorder(id)}>Reorder drills</Button>
      {canManage && <ManagerPanel />}
      {hasCapability(user?.roles ?? [], ...LOCALES) && <Button onClick={() => translatePage()}>Translate page</Button>}

      <SessionToolbar />
      <AdminTools />
    </form>
  )
}
