// Rendered unconditionally, but returns nothing for anyone who is not an admin: every control is guarded.
import { Button } from '@/components/ui'
import { resetAll } from '../api'

export default function AdminTools() {
  const { isAdmin } = useAuth()
  if (!isAdmin) return null
  return <Button onClick={() => resetAll()}>Reset attendance</Button>
}
