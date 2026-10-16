import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../../../components/ui'
import { cancelSupportClass } from '../api'

/** This week's lessons and the lesson plans behind them. */
export default function LessonsOverviewPage() {
  const { t } = useTranslation('lessons')
  const [, setCreating] = useState(false)
  // ADR-042: one control that opens a form, one that changes something — the only words on this screen
  // that name a support class.
  return (
    <>
      <PageHeader title={t('overview.title')} />
      <button type="button" onClick={() => setCreating(true)}>{t('actions.newSupportClass')}</button>
      <button type="button" onClick={() => cancelSupportClass()}>{t('actions.cancelSupportClass')}</button>
    </>
  )
}
