import {
  BriefcaseBusiness,
  Files,
  FolderSearch,
  LayoutDashboard,
  LifeBuoy,
  PanelLeftClose,
  UserRound,
} from 'lucide-react'
import type { View } from '../types'

const items = [
  { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
  { id: 'opportunities' as const, label: 'Opportunities', icon: FolderSearch },
  { id: 'applications' as const, label: 'Applications', icon: BriefcaseBusiness },
  { id: 'profile' as const, label: 'Profile', icon: UserRound },
  { id: 'documents' as const, label: 'Documents', icon: Files },
]

interface SidebarProps {
  view: View
  onNavigate: (view: View) => void
  open: boolean
  onClose: () => void
}

export function Sidebar({ view, onNavigate, open, onClose }: SidebarProps) {
  return (
    <aside className={`sidebar ${open ? 'sidebar--open' : ''}`} aria-label="Primary navigation">
      <div className="brand-row">
        <button className="brand" onClick={() => onNavigate('dashboard')} aria-label="ApplyOne dashboard">
          <span className="brand-mark" aria-hidden="true">1</span>
          <span>ApplyOne</span>
        </button>
        <button className="sidebar-close icon-button" onClick={onClose} aria-label="Close navigation">
          <PanelLeftClose aria-hidden="true" />
        </button>
      </div>

      <nav className="nav-list">
        {items.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`nav-item ${view === id ? 'nav-item--active' : ''}`}
            aria-current={view === id ? 'page' : undefined}
            onClick={() => {
              onNavigate(id)
              onClose()
            }}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className="account">
          <span className="avatar" aria-hidden="true">AK</span>
          <span><strong>Ayesha Khan</strong><small>ayesha@example.com</small></span>
        </div>
        <button className="nav-item nav-item--support">
          <LifeBuoy aria-hidden="true" />
          <span>Help & support</span>
        </button>
      </div>
    </aside>
  )
}
