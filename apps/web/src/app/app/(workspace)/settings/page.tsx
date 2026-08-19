import { signOut } from "@/app/app/actions";
import { requestAccountDeletion } from "@/server/account/actions";
import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { isAiConfigured } from "@/infra/ai/openai";
import { getCurrentUserAndProfile } from "@/lib/profile";
import { StatusPill } from "@/components/ui/status-pill";

export default async function SettingsPage() {
  const { profile } = await getCurrentUserAndProfile();
  const aiReady = isAiConfigured();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return (
    <WorkspaceMain>
      <PageHeader
        eyebrow="Settings"
        title="Account"
        body="Export your data, connect the browser extension, or delete Application Memory. API keys never ship in this browser session."
      />
      <div className="mt-8 grid max-w-2xl gap-6">
        <Card className="p-6">
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

        <Card className="p-6">
          <h2 className="text-base font-medium">Browser extension</h2>
          <p className="mt-2 text-sm text-ink-muted">
            In the extension Options page, set the app URL to <code>{appUrl}</code> and paste your Supabase user access
            token (never the service-role key). Save to 1-Apply, scan, and fill then talk to{" "}
            <code>/api/extension/session</code>, <code>/api/extension/applications</code>, and fill-plan.
          </p>
        </Card>

        <Card className="p-6">
          <h2 className="text-base font-medium">Export</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Download profile facts, evidence, applications, approved answers, and submission snapshots as JSON.
          </p>
          <a className="mt-4 inline-flex" href="/api/account/export">
            <Button type="button" variant="secondary">
              Download export
            </Button>
          </a>
        </Card>

        <Card className="p-6">
          <h2 className="text-base font-medium">Delete Application Memory</h2>
          <p className="mt-2 text-sm text-ink-muted">
            This deletes your profile and cascaded application data. Frozen snapshots are removed with the account. Type
            your email to confirm. Apply this SQL in Supabase if deletion is blocked:{" "}
            <code>20260819180000_account_deletion.sql</code>. Auth-user removal is not performed here.
          </p>
          <form action={requestAccountDeletion} className="mt-4 grid gap-3">
            <Input name="confirm" type="email" required placeholder={profile?.email ?? "you@example.com"} aria-label="Confirm email" />
            <Button type="submit" variant="secondary">
              Delete my data
            </Button>
          </form>
        </Card>
      </div>
    </WorkspaceMain>
  );
}
