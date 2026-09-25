import type { PageProps } from '../../pages/registry'
import { TerminalView } from './TerminalView'

export default function TerminalPage(_: PageProps) {
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <TerminalView />
    </div>
  )
}
