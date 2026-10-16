// Three levels below the page: past the depth controls are read to, so never listed.
import { Button } from '@/components/ui'
import { addNote } from '../api'

export default function DeepNote() {
  return <Button onClick={() => addNote()}>Add a note three levels down</Button>
}
