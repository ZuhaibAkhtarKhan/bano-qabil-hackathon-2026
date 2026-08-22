import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/data";
import { StatusPill } from "@/components/ui/status-pill";

type ResumeMatchRow = {
  id: string;
  document_id: string;
  document_version_id: string;
  score: number;
  suggestion: string | null;
  track?: string | null;
  explanation?: string | null;
  recommended?: boolean | null;
};

type DocumentRow = {
  id: string;
  label: string;
  type: string;
};

const TRACK_LABEL: Record<string, string> = {
  software_engineering: "Software Engineering",
  ai_ml: "AI/ML",
  web_development: "Web Development",
  research: "Research",
  general: "General",
};

export function ResumeMatchPanel({
  matches,
  documents,
}: {
  matches: ResumeMatchRow[];
  documents: DocumentRow[];
}) {
  const labels = new Map(documents.map((item) => [item.id, item.label]));
  const recommended = matches.find((item) => item.recommended) ?? matches[0];

  return (
    <Card id="resumes" className="scroll-mt-8 p-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-muted">Resume matching</p>
      <h2 className="mt-2 font-display text-2xl">Which resume should I use?</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
        Each stored resume is compared on its own. Rankings use the label, type, and any stored resume text. 1-Apply
        never invents experience that is not already in Application Memory.
      </p>

      {matches.length === 0 ? (
        <p className="mt-6 text-sm text-ink-muted">
          Upload Software Engineering, AI/ML, Web Development, Research, or General resumes, then refresh analysis.
        </p>
      ) : (
        <ul className="mt-6 grid gap-3">
          {matches.map((item) => {
            const track = TRACK_LABEL[item.track ?? ""] ?? item.track ?? labels.get(item.document_id) ?? "Resume";
            const isBest = recommended?.id === item.id;
            return (
              <li key={item.id} className="rounded-2xl border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {track}
                      <span className="ml-2 font-mono text-ink-muted">— {item.score}%</span>
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">{labels.get(item.document_id)}</p>
                  </div>
                  {isBest ? <StatusPill tone={item.score < 40 ? "sand" : "mint"}>{item.score < 40 ? "Weak field" : "Recommended"}</StatusPill> : null}
                </div>
                <div className="mt-3">
                  <Progress value={item.score} label={`${track} match`} />
                </div>
                <p className="mt-3 text-sm leading-6 text-ink-muted">{item.explanation ?? item.suggestion}</p>
              </li>
            );
          })}
        </ul>
      )}

      {recommended?.suggestion ? (
        <p className="mt-6 rounded-2xl border border-dashed border-line bg-canvas p-4 text-sm leading-6">
          {recommended.suggestion}
        </p>
      ) : null}
    </Card>
  );
}
