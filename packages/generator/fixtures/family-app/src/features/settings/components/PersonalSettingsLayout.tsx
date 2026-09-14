import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, PageHeader, Tabs } from '../../../components/ui'

const TABS = ['notif', 'tutorials']

/** Shared chrome for the personal settings pages: a header, the tabs, and the active tab's card. */
export default function PersonalSettingsLayout({ active, children }: { active: string; children: ReactNode }) {
  const { t } = useTranslation('settings')
  return (
    <div>
      <PageHeader title={t('personalPageTitle')} />
      <Tabs items={TABS.map((id) => ({ id, label: t(`sections.${id}`) }))} active={active} />
      <Card title={t(`sections.${active}`)}>{children}</Card>
    </div>
  )
}
