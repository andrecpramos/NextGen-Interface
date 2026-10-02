import { useTranslation } from 'react-i18next'
import { PageHeader } from '../../../components/ui'

/** Which emails and push messages this account receives. */
export default function NotificationsPage() {
  const { t } = useTranslation('settings')
  // A real multi-field form, because WP-27's guided steps are generated from
  // exactly this: a label bound by `htmlFor`, a literal label, an `aria-label`
  // with no visible label at all, and a submit button named by its own text.
  return (
    <form>
      <PageHeader title={t('notifications.title')} />
      <label htmlFor="notify-email">{t('notifications.email')}</label>
      <input id="notify-email" name="email" type="email" required />
      <label htmlFor="notify-frequency">Digest frequency</label>
      <select id="notify-frequency" name="frequency" />
      <input name="quietHours" type="text" aria-label="Quiet hours" />
      <button type="submit">{t('notifications.save')}</button>
    </form>
  )
}
