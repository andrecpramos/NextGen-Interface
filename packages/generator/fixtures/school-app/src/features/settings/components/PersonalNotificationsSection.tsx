import { useTranslation } from 'react-i18next'

export default function PersonalNotificationsSection() {
  const { t } = useTranslation('settings')
  return (
    <form>
      <label htmlFor="notify-email">{t('notifications.email')}</label>
      <input id="notify-email" name="email" type="email" />
    </form>
  )
}
