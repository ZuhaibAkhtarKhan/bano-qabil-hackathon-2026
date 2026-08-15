import { Bell, Menu, Search } from 'lucide-react'

interface TopbarProps { onMenu: () => void }

export function Topbar({ onMenu }: TopbarProps) {
  return (
    <header className="topbar">
      <button className="icon-button mobile-menu" onClick={onMenu} aria-label="Open navigation">
        <Menu aria-hidden="true" />
      </button>
      <div className="topbar-actions">
        <button className="icon-button" aria-label="Search"><Search aria-hidden="true" /></button>
        <button className="icon-button notification" aria-label="Notifications, 3 unread">
          <Bell aria-hidden="true" />
          <span className="notification-dot" aria-hidden="true">3</span>
        </button>
        <button className="user-menu" aria-label="Open account menu">
          <span className="avatar avatar--small" aria-hidden="true">AK</span>
          <span className="user-menu-name">Ayesha</span>
        </button>
      </div>
    </header>
  )
}
