import { CheckCircle2, Save } from 'lucide-react'
import { FormEvent, useState } from 'react'
import type { ProfileData } from '../types'

const initialProfile: ProfileData = {
  name: 'Ayesha Khan', headline: 'Computer science student building trustworthy AI products', email: 'ayesha@example.com', university: 'NED University', graduation: '2027', linkedIn: 'linkedin.com/in/ayeshakhan', github: 'github.com/ayesha-khan',
}

export function ProfileView() {
  const [profile, setProfile] = useState<ProfileData>(() => {
    try { return JSON.parse(localStorage.getItem('applyone-profile') ?? '') as ProfileData } catch { return initialProfile }
  })
  const [saved, setSaved] = useState(false)

  function submit(event: FormEvent) {
    event.preventDefault()
    localStorage.setItem('applyone-profile', JSON.stringify(profile))
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2500)
  }

  return (
    <main className="page profile-page" id="main-content">
      <header className="collection-heading"><div><h1>Your persistent profile</h1><p>Confirm it once. ApplyOne reuses only the evidence you approve.</p></div><div className="profile-score"><strong>82%</strong><span>complete</span></div></header>
      <form className="profile-form" onSubmit={submit}>
        <section className="panel form-section"><div className="form-section-heading"><div><h2>Core details</h2><p>Used for standard application fields.</p></div><CheckCircle2 aria-label="Verified" /></div>
          <div className="form-grid">
            {([
              ['name', 'Full name'], ['email', 'Email address'], ['headline', 'Professional headline'], ['university', 'University'], ['graduation', 'Graduation year'], ['linkedIn', 'LinkedIn'], ['github', 'GitHub'],
            ] as const).map(([key, label]) => (
              <label className={key === 'headline' ? 'form-field form-field--wide' : 'form-field'} key={key}>{label}<input value={profile[key]} onChange={(event) => setProfile((current) => ({ ...current, [key]: event.target.value }))} /></label>
            ))}
          </div>
        </section>
        <section className="panel evidence-editor"><div><h2>Evidence library</h2><p>Five verified items can be used to ground your answers.</p></div><button type="button" className="secondary-button">Review evidence</button></section>
        <div className="save-row"><span role="status" aria-live="polite">{saved ? 'Profile saved successfully.' : ''}</span><button className="primary-button" type="submit"><Save aria-hidden="true" /> Save profile</button></div>
      </form>
    </main>
  )
}
