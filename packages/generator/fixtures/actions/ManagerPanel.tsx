// Nothing in here says who may use it: the page renders it only under `canManage`.
import { Button } from '@/components/ui'
import { approve } from '../api'

export default function ManagerPanel() {
  return <Button onClick={() => approve()}>Approve budget</Button>
}
