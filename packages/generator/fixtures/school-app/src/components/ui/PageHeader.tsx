import { useTranslation } from 'react-i18next'

/** The design system's page header. It knows nothing about any screen it sits on. */
export function PageHeader({ title }: { title: string }) {
  const { t } = useTranslation('common')
  return (
    <header>
      <button type="button">{t('actions.back')}</button>
      <h1>{title}</h1>
    </header>
  )
}
