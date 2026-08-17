import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { SemanticBadge } from "@/components/ui/status-pill";
import { loadIntegrationsWorkspace } from "@/server/workspace/queries";

export default async function IntegrationsPage() {
  const { integrations } = await loadIntegrationsWorkspace();

  return (
    <WorkspaceMain>
      <PageHeader
        eyebrow="Integrations"
        title="Connected accounts"
        body="Gmail, calendar, and other providers stay disconnected until you actually authorize them. This page never pretends a connection exists."
      />
      {integrations.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            eyebrow="None connected"
            title="No integrations on this account"
            body="Autofill, inbox, and calendar stay off until a later phase. Secrets never live in this browser session."
          />
        </div>
      ) : (
        <ul className="mt-8 grid max-w-2xl gap-4">
          {integrations.map((item) => (
            <li key={item.id}>
              <Card as="article">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-medium">{item.provider}</h2>
                    <p className="mt-1 text-sm text-ink-muted">
                      {item.kind}
                      {item.account_label ? ` · ${item.account_label}` : ""}
                    </p>
                  </div>
                  <SemanticBadge
                    status={
                      item.status === "connected"
                        ? "verified"
                        : item.status === "error"
                          ? "failed"
                          : item.status === "revoked"
                            ? "rejected"
                            : "unknown"
                    }
                  />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </WorkspaceMain>
  );
}
