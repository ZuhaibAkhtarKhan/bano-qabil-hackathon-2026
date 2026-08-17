import { signOut } from "@/app/app/actions";
import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { isAiConfigured } from "@/infra/ai/openai";
import { getCurrentUserAndProfile } from "@/lib/profile";
import { StatusPill } from "@/components/ui/status-pill";

export default async function SettingsPage() {
  const { profile } = await getCurrentUserAndProfile();
  const aiReady = isAiConfigured();

  return (
    <WorkspaceMain>
      <PageHeader
        eyebrow="Settings"
        title="Account"
        body="Export and deletion workflows will be added with the data-control phase. Sign out is available now. API keys never ship in this browser session."
      />
      <Card className="mt-8 max-w-xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-medium">Session</h2>
            <p className="mt-2 text-sm">
              Signed in as <strong>{profile?.email}</strong>
            </p>
          </div>
          <StatusPill tone={aiReady ? "mint" : "muted"}>{aiReady ? "Provider ready" : "Not configured"}</StatusPill>
        </div>
        <p className="mt-3 text-sm text-ink-muted">
          {aiReady
            ? "Server AI provider is configured. Drafts still require verified evidence."
            : "Server AI provider is not configured — write answers from verified evidence yourself."}
        </p>
        <form action={signOut} className="mt-5">
          <Button type="submit" variant="secondary">
            Sign out
          </Button>
        </form>
      </Card>
    </WorkspaceMain>
  );
}
