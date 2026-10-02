// ADR-031: controls whose only job is to show something, and look-alikes that do something. Read by
// `pages.test.ts` alone — this page belongs to no fixture app, so no registry or golden decision moves.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertDialog, AlertDialogTrigger, Button, Dialog, DialogTrigger, IconButton, Sheet, SheetTrigger } from '@/components/ui'
import { deleteEvent, saveEvent } from '../api'

export default function EventsPage() {
  const { t } = useTranslation('events')
  const [open, setOpen] = useState(false)
  const [filters, setFilters] = useState(false)
  const [showImport, setShowImport] = useState(false)

  return (
    <div>
      {/* Opens: state that shows something. */}
      <Button onClick={() => setOpen(true)}>{t('actions.new')}</Button>
      <Button onClick={() => setFilters((v) => !v)}>Filters</Button>
      <IconButton aria-label="Import events" onClick={() => { setShowImport(!showImport) }} />
      {/* Opens: a trigger, and a trigger whose button is its child. */}
      <DialogTrigger>Invite people</DialogTrigger>
      <SheetTrigger asChild><Button>Share calendar</Button></SheetTrigger>

      {/* Does something: never an opener. */}
      <Button onClick={() => saveEvent()}>Save</Button>
      <Button onClick={() => { setOpen(false); deleteEvent() }}>Delete</Button>
      <Button onClick={() => setOpen(false)}>Close</Button>
      <AlertDialogTrigger>Remove all</AlertDialogTrigger>

      <Dialog open={open} />
      <Sheet open={filters} />
      <AlertDialog />
    </div>
  )
}
