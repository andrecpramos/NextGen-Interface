// Two levels below the page: still the page's own controls.
import { Button } from '@/components/ui'
import { markPresent } from '../api'
import DeepNote from './DeepNote'

export default function AttendanceSheet() {
  return (
    <section>
      <Button onClick={() => markPresent()}>Mark attendance</Button>
      <DeepNote />
    </section>
  )
}
