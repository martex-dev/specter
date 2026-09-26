// "Add apps" picker (dock "+" button / webpanels.add).
import { useState } from 'react'
import { LayoutGrid } from 'lucide-react'
import { Modal, Seg } from '../../components/ui'
import { newTab } from '../../stores/browser'
import { closeOverlay } from '../../stores/ui'
import { CatalogGrid, CustomAppForm } from './Catalog'
import { useWebApps } from './store'

export default function AddAppsOverlay() {
  const count = useWebApps((s) => s.apps.length)
  const [tab, setTab] = useState<'catalog' | 'custom'>('catalog')
  return (
    <Modal
      title={count ? 'Add web apps' : 'Put your apps in the sidebar'}
      icon={<LayoutGrid size={16} className="accent" />}
      width={780}
      onClose={closeOverlay}
      footer={
        <>
          <button
            className="btn ghost"
            onClick={() => {
              closeOverlay()
              newTab('specter://webapps')
            }}
          >
            Manage web apps…
          </button>
          <span className="spacer" />
          <button className="btn primary" onClick={closeOverlay}>
            Done
          </button>
        </>
      }
    >
      <div className="wa-picker">
        <p className="muted wa-picker-intro">
          {count
            ? `${count} app${count === 1 ? '' : 's'} in your sidebar.`
            : 'Pick the messengers, music and AI apps you want one click away.'}{' '}
          They keep running in the background after you close their panel and share logins with your normal tabs.
        </p>
        <Seg
          value={tab}
          options={[
            { value: 'catalog', label: 'Catalog' },
            { value: 'custom', label: 'Custom app' }
          ]}
          onChange={setTab}
        />
        <div className="wa-picker-body">{tab === 'catalog' ? <CatalogGrid onOpen={closeOverlay} /> : <CustomAppForm onAdded={() => closeOverlay()} />}</div>
      </div>
    </Modal>
  )
}
