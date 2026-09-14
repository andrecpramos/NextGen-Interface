import PersonalSettingsLayout from '../components/PersonalSettingsLayout'
import PersonalNotificationsSection from '../components/PersonalNotificationsSection'

/** `/settings/notifications` — which messages this account receives, and how. */
export default function PersonalNotificationsPage() {
  return (
    <PersonalSettingsLayout active="notif">
      <PersonalNotificationsSection />
    </PersonalSettingsLayout>
  )
}
