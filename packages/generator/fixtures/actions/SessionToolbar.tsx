// A toolbar the sessions page renders: its controls are the page's too.
import { useState } from 'react'
import { Button } from '@/components/ui'
import { exportPdf } from '../api'
import AttendanceSheet from './AttendanceSheet'

export default function SessionToolbar() {
  const [filters, setShowFilters] = useState(false)
  return (
    <div>
      <Button onClick={exportPdf}>Export PDF</Button>
      <Button onClick={() => setShowFilters(true)}>Filters</Button>
      <AttendanceSheet />
    </div>
  )
}
