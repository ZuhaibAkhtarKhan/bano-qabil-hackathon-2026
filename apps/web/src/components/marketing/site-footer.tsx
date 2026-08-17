import Link from "next/link";

import { Wordmark } from "@/components/brand/wordmark";

const columns = [
  {
    title: "Capabilities",
    links: ["Application Memory", "Fit Index", "Grounded answers", "Smart Autofill", "Deadline tracking"],
  },
  {
    title: "Workflows",
    links: ["Jobs", "Internships", "Scholarships", "Hackathons", "Fellowships"],
  },
  {
    title: "Control",
    links: ["Evidence review", "Answer approval", "Document versions", "No auto-submit"],
  },
  {
    title: "Company",
    links: ["Safety", "Privacy", "Responsible AI"],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-obsidian-line bg-obsidian text-zinc-300">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[1.4fr_repeat(4,minmax(0,1fr))]">
        <div>
          <Wordmark inverted />
          <p className="mt-4 max-w-xs text-sm leading-6 text-zinc-400">
            Create once. Apply everywhere. A trusted application memory that never invents who you are.
          </p>
        </div>
        {columns.map((column) => (
          <div key={column.title}>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">{column.title}</p>
            <ul className="mt-4 space-y-2 text-sm">
              {column.links.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-obsidian-line px-5 py-5 text-xs text-zinc-500 sm:px-8">
        <p>© {new Date().getFullYear()} 1-Apply. Truth before fluency.</p>
        <div className="flex gap-4">
          <Link href="/sign-in">Sign in</Link>
          <a href="#safety">Safety</a>
        </div>
      </div>
    </footer>
  );
}
