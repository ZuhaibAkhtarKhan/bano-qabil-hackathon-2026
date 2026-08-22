import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { SemanticBadge } from "@/components/ui/status-pill";
import { evidenceSemanticStatus } from "@/lib/status";
import type { EvidenceRow } from "@/server/types";

export function EvidenceReviewList({
  evidence,
  actions,
  empty,
}: {
  evidence: EvidenceRow[];
  actions?: (item: EvidenceRow) => ReactNode;
  empty?: ReactNode;
}) {
  if (evidence.length === 0) {
    return empty ?? <p className="text-sm text-ink-muted">No extracted items yet.</p>;
  }

  const extracted = evidence.filter((item) => item.source?.startsWith("document:"));
  const manual = evidence.filter((item) => !item.source?.startsWith("document:"));

  return (
    <div className="grid gap-6">
      {extracted.length > 0 ? (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-2xl">Extracted from documents</h2>
            <SemanticBadge status="ai_generated" />
          </div>
          <p className="mt-2 text-sm text-ink-muted">
            Extraction is not verification. Confirm only facts you can stand behind.
          </p>
          <ul className="mt-4 grid gap-4">
            {extracted.map((item) => (
              <li key={item.id}>
                <Card as="article">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-medium">{item.title}</h3>
                      <p className="mt-1 text-sm text-ink-muted">
                        {item.kind.replace("_", " ")}
                        {item.organization ? ` · ${item.organization}` : ""}
                      </p>
                    </div>
                    <SemanticBadge status={evidenceSemanticStatus({ verificationStatus: item.verification_status, excludedFromAi: item.excluded_from_ai })} />
                  </div>
                  {item.outcome ? <p className="mt-3 text-sm">{item.outcome}</p> : null}
                  {item.skills?.length ? (
                    <p className="mt-2 text-xs text-ink-muted">Skills: {item.skills.join(", ")}</p>
                  ) : null}
                  {actions ? <div className="mt-4">{actions(item)}</div> : null}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {manual.length > 0 ? (
        <section>
          <h2 className="font-display text-2xl">Added manually</h2>
          <ul className="mt-4 grid gap-4">
            {manual.map((item) => (
              <li key={item.id}>
                <Card as="article">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h3 className="text-base font-medium">{item.title}</h3>
                    <SemanticBadge status={evidenceSemanticStatus({ verificationStatus: item.verification_status, excludedFromAi: item.excluded_from_ai })} />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
