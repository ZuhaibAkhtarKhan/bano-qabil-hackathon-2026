import { CalendarDays, ChevronRight, Filter, Search } from 'lucide-react'
import { applications } from '../data'

export function ApplicationsView() {
  return (
    <main className="page collection-page" id="main-content">
      <header className="collection-heading"><div><h1>Applications</h1><p>Every application, answer, and document version in one place.</p></div><button className="primary-button">New application</button></header>
      <div className="collection-toolbar">
        <label className="search-control"><Search aria-hidden="true" /><span className="sr-only">Search applications</span><input placeholder="Search applications" /></label>
        <button className="secondary-button"><Filter aria-hidden="true" /> Filter</button>
      </div>
      <section className="collection-list" aria-label="Applications">
        {applications.map((application) => (
          <article className="collection-row" key={application.id}>
            <span className={`application-symbol application-symbol--${application.tone}`} aria-hidden="true">{application.title[0]}</span>
            <div><h2>{application.title}</h2><p>{application.organization} · {application.type}</p></div>
            <span><CalendarDays aria-hidden="true" /> {application.deadlineLabel}</span>
            <span className={`status status--${application.tone}`}><i aria-hidden="true" />{application.status}</span>
            <button className="icon-button" aria-label={`Open ${application.title}`}><ChevronRight aria-hidden="true" /></button>
          </article>
        ))}
      </section>
    </main>
  )
}
