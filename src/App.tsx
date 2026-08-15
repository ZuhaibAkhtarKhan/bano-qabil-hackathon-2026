import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import type { View } from './types'
import { ApplicationsView } from './views/ApplicationsView'
import { Dashboard } from './views/Dashboard'
import { OpportunityWorkspace } from './views/OpportunityWorkspace'
import { ProfileView } from './views/ProfileView'
import { SimpleView } from './views/SimpleView'

export function App() {
  const [view, setView] = useState<View>('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [analysisUrl, setAnalysisUrl] = useState('')

  function analyze(url: string) {
    setAnalysisUrl(url)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function navigate(nextView: View) {
    setAnalysisUrl('')
    setView(nextView)
  }

  let content
  if (analysisUrl) content = <OpportunityWorkspace url={analysisUrl} onBack={() => setAnalysisUrl('')} />
  else if (view === 'dashboard') content = <Dashboard onAnalyze={analyze} onNavigate={navigate} />
  else if (view === 'applications') content = <ApplicationsView />
  else if (view === 'profile') content = <ProfileView />
  else content = <SimpleView view={view} onAnalyze={analyze} />

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Sidebar view={view} onNavigate={navigate} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      {sidebarOpen ? <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} /> : null}
      <div className="app-content">
        <Topbar onMenu={() => setSidebarOpen(true)} />
        {content}
      </div>
    </div>
  )
}
