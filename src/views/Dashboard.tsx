import { ArrowRight, CalendarDays, CheckCircle2, CircleAlert, ExternalLink, FileText } from 'lucide-react'
import { applications, evidence } from '../data'
import type { View } from '../types'
import { OpportunityComposer } from '../components/OpportunityComposer'
import { WorkflowSpine } from '../components/WorkflowSpine'

interface DashboardProps {
  onAnalyze: (url: string) => void
  onNavigate: (view: View) => void
}

export function Dashboard({ onAnalyze, onNavigate }: DashboardProps) {
  const pipeline = [
    ['Draft', 2], ['Ready', 1], ['Submitted', 1], ['Interview', 1],
  ] as const

  return (
    <main className="page dashboard" id="main-content">
      <section className="dashboard-heading">
        <div>
          <h1>Good morning, Ayesha</h1>
          <p>Let’s keep your opportunities moving forward.</p>
        </div>
        <button className="text-button mobile-profile-link" onClick={() => onNavigate('profile')}>Profile 82% <ArrowRight aria-hidden="true" /></button>
      </section>

      <div className="dashboard-grid">
        <section className="main-column" aria-label="Application overview">
          <OpportunityComposer onAnalyze={onAnalyze} />

          <div className="overview-split">
            <section className="panel due-panel" aria-labelledby="due-title">
              <div className="section-heading">
                <h2 id="due-title">Due soon</h2>
                <button className="text-button" onClick={() => onNavigate('applications')}>View all</button>
              </div>
              <div className="application-list">
                {applications.slice(0, 3).map((application) => (
                  <button className="application-row" key={application.id} onClick={() => onNavigate('applications')}>
                    <span className={`application-symbol application-symbol--${application.tone}`} aria-hidden="true">{application.title.slice(0, 1)}</span>
                    <span className="application-main"><strong>{application.title}</strong><small>{application.type}</small></span>
                    <span className="application-date"><CalendarDays aria-hidden="true" /> <span>{application.deadlineLabel}</span></span>
                    <span className={`status status--${application.tone}`}><i aria-hidden="true" />{application.status}</span>
                    <ArrowRight className="row-arrow" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </section>

            <section className="panel pipeline-panel" aria-labelledby="pipeline-title">
              <div className="section-heading"><h2 id="pipeline-title">Application pipeline</h2></div>
              <div className="pipeline-columns">
                {pipeline.map(([label, count]) => (
                  <div className="pipeline-column" key={label}>
                    <span className={`pipeline-dot pipeline-dot--${label.toLowerCase()}`} aria-hidden="true" />
                    <strong>{label}</strong>
                    <b>{count}</b>
                    {Array.from({ length: Math.min(count, 2) }, (_, index) => <FileText key={index} aria-hidden="true" />)}
                  </div>
                ))}
              </div>
              <button className="text-button pipeline-link" onClick={() => onNavigate('applications')}>View all applications <ArrowRight aria-hidden="true" /></button>
            </section>
          </div>

          <section className="panel active-workspace" aria-labelledby="workspace-title">
            <div className="workspace-heading">
              <div><h2 id="workspace-title">OpenAI Residency</h2><ExternalLink aria-hidden="true" /><span className="status-tag">In progress</span></div>
              <small>Updated 2h ago</small>
            </div>
            <WorkflowSpine />
            <div className="workspace-footer">
              <div>
                <strong>Answers</strong>
                <p>We’re tailoring your answers to this opportunity’s questions.</p>
                <button className="text-button" onClick={() => onNavigate('applications')}>Continue answering <ArrowRight aria-hidden="true" /></button>
              </div>
              <div className="answer-progress">
                <span><small>Questions answered</small><b>6 / 12</b></span>
                <progress value="6" max="12">6 of 12</progress>
                <span><small>Estimated time to complete</small><b>30–40 min</b></span>
              </div>
            </div>
          </section>
        </section>

        <aside className="right-rail" aria-label="Profile and evidence">
          <section className="panel profile-completion">
            <div>
              <h2>Profile completion</h2>
              <p>Great progress. Complete the missing items to strengthen every application.</p>
              <button className="text-button" onClick={() => onNavigate('profile')}>Go to profile <ArrowRight aria-hidden="true" /></button>
            </div>
            <div className="completion-ring" aria-label="Profile 82 percent complete"><span>82%</span></div>
          </section>

          <section className="panel evidence-panel" aria-labelledby="evidence-title">
            <div className="section-heading"><h2 id="evidence-title">Evidence health</h2></div>
            <h3 className="verified-title">Verified ({evidence.length})</h3>
            <ul className="evidence-list">
              {evidence.map((item) => (
                <li key={item.name}><CheckCircle2 aria-hidden="true" /><span>{item.name}</span><small>{item.source}</small></li>
              ))}
            </ul>
            <div className="attention">
              <h3>Needs attention (1)</h3>
              <button onClick={() => onNavigate('profile')}>
                <CircleAlert aria-hidden="true" />
                <span><strong>Recommendation letter</strong><small>Add at least one recommender</small></span>
                <ArrowRight aria-hidden="true" />
              </button>
            </div>
            <button className="text-button" onClick={() => onNavigate('profile')}>Manage evidence <ArrowRight aria-hidden="true" /></button>
          </section>
        </aside>
      </div>
    </main>
  )
}
