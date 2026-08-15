import { ArrowRight, Link2, Sparkles } from 'lucide-react'
import { FormEvent, useState } from 'react'

interface OpportunityComposerProps {
  onAnalyze: (url: string) => void
  compact?: boolean
}

export function OpportunityComposer({ onAnalyze, compact = false }: OpportunityComposerProps) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!url.trim()) {
      setError('Paste an opportunity link to continue.')
      return
    }
    setError('')
    onAnalyze(url.trim())
  }

  return (
    <form className={`opportunity-composer ${compact ? 'opportunity-composer--compact' : ''}`} onSubmit={submit} noValidate>
      <div className="composer-input-wrap">
        <Link2 aria-hidden="true" />
        <label className="sr-only" htmlFor="opportunity-url">Opportunity link</label>
        <input
          id="opportunity-url"
          type="url"
          placeholder="Paste an opportunity link"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          aria-describedby={error ? 'opportunity-error' : 'opportunity-help'}
          aria-invalid={Boolean(error)}
        />
      </div>
      <button className="primary-button" type="submit">
        <Sparkles aria-hidden="true" />
        <span>Analyze opportunity</span>
        {compact ? <ArrowRight aria-hidden="true" /> : null}
      </button>
      <p id={error ? 'opportunity-error' : 'opportunity-help'} className={error ? 'form-error' : 'composer-help'} role={error ? 'alert' : undefined}>
        {error || "We'll analyze the opportunity and suggest the best path forward."}
      </p>
    </form>
  )
}
