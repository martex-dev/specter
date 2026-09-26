// Panel header controls for a web app (rendered by the side-panel host).
import { ArrowLeft, ArrowUpRight, Home, MoreHorizontal, RotateCw } from 'lucide-react'
import { openMenu } from '../../stores/ui'
import { appMenuItems } from './menus'
import { goBack, goHome, openInTab, reloadApp, useRuntime } from './store'

/** Panel header controls (rendered by the side-panel host). */
export function WebAppHeader({ id }: { id: string }) {
  const rt = useRuntime(id)
  return (
    <>
      <button className="icon-btn sm" disabled={!rt.canGoBack} onClick={() => goBack(id)} aria-label="Back" data-tip="Back">
        <ArrowLeft size={13} />
      </button>
      <button className="icon-btn sm" onClick={() => reloadApp(id)} aria-label="Reload" data-tip="Reload">
        <RotateCw size={13} />
      </button>
      <button className="icon-btn sm" disabled={!rt.live} onClick={() => goHome(id)} aria-label="Home" data-tip="Home page">
        <Home size={13} />
      </button>
      <button className="icon-btn sm" onClick={() => openInTab(id)} aria-label="Open in tab" data-tip="Open current page in a tab">
        <ArrowUpRight size={13} />
      </button>
      <button
        className="icon-btn sm"
        aria-label="More"
        data-tip="App options"
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          openMenu({ x: r.left, y: r.bottom + 4, items: appMenuItems(id), width: 230 })
        }}
      >
        <MoreHorizontal size={14} />
      </button>
    </>
  )
}

