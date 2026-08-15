import { FilePlus2, FolderSearch } from 'lucide-react'
import type { View } from '../types'
import { OpportunityComposer } from '../components/OpportunityComposer'

interface SimpleViewProps { view: Extract<View, 'opportunities' | 'documents'>; onAnalyze: (url: string) => void }

export function SimpleView({ view, onAnalyze }: SimpleViewProps) {
  const isOpportunities = view === 'opportunities'
  return (
    <main className="page simple-page" id="main-content">
      <header><h1>{isOpportunities ? 'Find your next opportunity' : 'Document vault'}</h1><p>{isOpportunities ? 'Bring any public application link. ApplyOne will organize the rest.' : 'The exact version you choose stays attached to every application.'}</p></header>
      {isOpportunities ? <OpportunityComposer onAnalyze={onAnalyze} compact /> : (
        <section className="panel empty-vault"><FilePlus2 aria-hidden="true" /><h2>Your verified documents</h2><p>Resume AI v3, University transcript, and two certificates are ready to use.</p><button className="primary-button">Upload document</button></section>
      )}
      {isOpportunities ? <div className="opportunity-empty"><FolderSearch aria-hidden="true" /><h2>Analyze an opportunity to begin</h2><p>We’ll extract the requirements, check eligibility, and prepare an evidence-backed workspace.</p></div> : null}
    </main>
  )
}
