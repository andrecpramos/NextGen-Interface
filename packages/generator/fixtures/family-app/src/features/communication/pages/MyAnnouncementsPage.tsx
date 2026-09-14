import { useTranslation } from 'react-i18next'
import { PageHeader, EmptyState } from '../../../components/ui'

function AnnouncementRow({ sender }: { sender: string }) {
  const { t } = useTranslation('communication')
  return (
    <p>
      {t('announcement.from')} {sender}
    </p>
  )
}

/** Announcements from the club, with a read confirmation where one is asked for. */
export default function MyAnnouncementsPage() {
  const { t: tp } = useTranslation('player')
  return (
    <div>
      <PageHeader title={tp('announcements.title')} subtitle={tp('announcements.subtitle')} />
      <EmptyState title={tp('announcements.empty.title')} />
      <AnnouncementRow sender="Direção" />
    </div>
  )
}
