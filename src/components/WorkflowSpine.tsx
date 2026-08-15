import { Check, FileCheck2, Files, ScanSearch, UserCheck } from 'lucide-react'

const steps = [
  { label: 'Analyze', state: 'complete', icon: ScanSearch },
  { label: 'Eligibility', state: 'complete', icon: UserCheck },
  { label: 'Answers', state: 'current', icon: FileCheck2 },
  { label: 'Documents', state: 'pending', icon: Files },
  { label: 'Review', state: 'pending', icon: Check },
]

export function WorkflowSpine() {
  return (
    <ol className="workflow" aria-label="Application progress">
      {steps.map(({ label, state, icon: Icon }) => (
        <li key={label} className={`workflow-step workflow-step--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
          <span className="workflow-icon"><Icon aria-hidden="true" /></span>
          <span className="workflow-label">{label}</span>
          <small>{state === 'complete' ? 'Completed' : state === 'current' ? 'In progress' : 'Pending'}</small>
        </li>
      ))}
    </ol>
  )
}
