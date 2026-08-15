import { ArrowLeft, CheckCircle2, CircleAlert, FileText, ShieldCheck, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'

interface OpportunityWorkspaceProps {
  url: string
  onBack: () => void
}

const requirements = [
  { title: 'Technical or quantitative degree', detail: 'Matched: BS Computer Science', state: 'met' },
  { title: 'Evidence of building AI systems', detail: 'Matched: 3 verified projects', state: 'met' },
  { title: 'Available full-time for six months', detail: 'Your availability is missing', state: 'unclear' },
]

export function OpportunityWorkspace({ url, onBack }: OpportunityWorkspaceProps) {
  const [stage, setStage] = useState<'analyzing' | 'ready'>('analyzing')
  const [answer, setAnswer] = useState('')
  const [approved, setApproved] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setStage('ready'), 1100)
    return () => window.clearTimeout(timer)
  }, [])

  function generateAnswer() {
    setAnswer('I build practical AI tools around real user needs. While leading ApplyOne, I designed an evidence-grounded workflow that turns verified applicant experiences into tailored responses without inventing claims. I also coordinated a four-person hackathon team and shipped the working prototype under a two-day deadline. That combination of applied machine learning, product judgment, and fast execution is what I hope to deepen through the residency.')
    setApproved(false)
  }

  if (stage === 'analyzing') {
    return (
      <main className="page analysis-loading" id="main-content" aria-live="polite">
        <div className="analysis-orbit"><Sparkles aria-hidden="true" /></div>
        <h1>Reading the opportunity</h1>
        <p>Extracting requirements, questions, and documents from <span>{url}</span></p>
        <div className="loading-line" aria-hidden="true"><i /></div>
      </main>
    )
  }

  return (
    <main className="page workspace-page" id="main-content">
      <button className="back-button" onClick={onBack}><ArrowLeft aria-hidden="true" /> Back to dashboard</button>
      <header className="opportunity-title">
        <div><span className="application-symbol application-symbol--blue" aria-hidden="true">O</span></div>
        <div><h1>OpenAI Residency</h1><p>Research residency · San Francisco, CA · Applications close 24 August</p></div>
        <span className="analysis-status"><CheckCircle2 aria-hidden="true" /> Analysis ready</span>
      </header>

      <div className="workspace-layout">
        <div className="workspace-main">
          <section className="panel eligibility-card" aria-labelledby="eligibility-title">
            <div className="section-heading">
              <div><h2 id="eligibility-title">Eligibility check</h2><p>Based on explicit requirements and your verified profile.</p></div>
              <strong>2 of 3 matched</strong>
            </div>
            <div className="requirement-list">
              {requirements.map((requirement) => (
                <div className={`requirement requirement--${requirement.state}`} key={requirement.title}>
                  {requirement.state === 'met' ? <CheckCircle2 aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
                  <span><strong>{requirement.title}</strong><small>{requirement.detail}</small></span>
                  <b>{requirement.state === 'met' ? 'Met' : 'Unclear'}</b>
                </div>
              ))}
            </div>
          </section>

          <section className="panel answer-studio" aria-labelledby="answer-title">
            <div className="section-heading"><div><h2 id="answer-title">Answer studio</h2><p>Question 1 of 4 · 200 word limit</p></div><span className="evidence-count"><ShieldCheck aria-hidden="true" /> 3 evidence sources</span></div>
            <label htmlFor="motivation-answer">Why are you interested in this residency, and what would you bring?</label>
            <textarea
              id="motivation-answer"
              value={answer}
              onChange={(event) => { setAnswer(event.target.value); setApproved(false) }}
              placeholder="Generate a grounded first draft, or start writing here…"
              rows={8}
            />
            <div className="answer-actions">
              <small>{answer ? `${answer.trim().split(/\s+/).length} / 200 words` : 'No draft yet'}</small>
              <div>
                <button className="secondary-button" onClick={generateAnswer}><Sparkles aria-hidden="true" /> {answer ? 'Regenerate' : 'Generate draft'}</button>
                <button className="primary-button" disabled={!answer} onClick={() => setApproved(true)}>{approved ? <CheckCircle2 aria-hidden="true" /> : null}{approved ? 'Approved' : 'Approve answer'}</button>
              </div>
            </div>
            {answer ? (
              <div className="source-note" role="status">
                <ShieldCheck aria-hidden="true" />
                <span><strong>Grounded in verified evidence</strong><small>ApplyOne project · Hackathon leadership · Applied ML experience</small></span>
              </div>
            ) : null}
          </section>
        </div>

        <aside className="workspace-aside">
          <section className="panel source-summary">
            <h2>Opportunity summary</h2>
            <dl><div><dt>Category</dt><dd>Residency</dd></div><div><dt>Location</dt><dd>San Francisco</dd></div><div><dt>Deadline</dt><dd>24 Aug 2026</dd></div><div><dt>Questions</dt><dd>4 found</dd></div></dl>
            <a href={url} target="_blank" rel="noreferrer"><FileText aria-hidden="true" /> View source page</a>
          </section>
          <section className="panel document-match">
            <h2>Documents</h2>
            <div><FileText aria-hidden="true" /><span><strong>AI-focused resume</strong><small>resume-ai-v3.pdf</small></span><CheckCircle2 aria-label="Selected" /></div>
            <button className="text-button">Change document</button>
          </section>
        </aside>
      </div>
    </main>
  )
}
