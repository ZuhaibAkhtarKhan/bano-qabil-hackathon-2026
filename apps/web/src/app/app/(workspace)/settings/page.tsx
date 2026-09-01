import { signOut } from "@/app/app/actions";
import { requestAccountDeletion } from "@/server/account/actions";
import { FlashBanner } from "@/components/app/flash-banner";
import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { ExtensionConnectCard } from "@/components/settings/extension-connect-card";
import { Button, SubmitButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { isAiConfigured } from "@/infra/ai/openai";
import { describeAiStatus } from "@/infra/ai/status";
import { getCurrentUserAndProfile } from "@/lib/profile";
import { parseWorkspacePreferences } from "@/lib/workspace-preferences";
import { StatusPill } from "@/components/ui/status-pill";
import { updatePrepareAndSend, updateTimezone } from "@/server/memory/actions";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { profile } = await getCurrentUserAndProfile();
  const { notice, error } = await searchParams;
  const aiReady = isAiConfigured();
  const aiStatus = describeAiStatus();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const prefs = parseWorkspacePreferences(profile?.preferences ?? {});

  return (
    <WorkspaceMain>
      <PageHeader
        eyebrow="Settings"
        title="Account"
        body="Export your data, connect the browser extension, or delete Application Memory. API keys never ship in this browser session."
      />
      <FlashBanner notice={notice} error={error} />
      <div className="mt-8 grid max-w-2xl gap-6">
        <Card className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-medium">Session</h2>
              <p className="mt-2 text-sm">
                Signed in as <strong>{profile?.email}</strong>
              </p>
            </div>
            <StatusPill tone={aiReady ? "mint" : "muted"}>
              {aiReady ? `${aiStatus.chatProvider} ready` : "Not configured"}
            </StatusPill>
          </div>
          <p className="mt-3 text-sm text-ink-muted">
            {aiReady
              ? `Server AI: ${aiStatus.chatProvider} (${aiStatus.chatModel ?? "model"}) in ${aiStatus.mode} mode. Drafts still require verified evidence.`
              : "Set GROQ_API_KEY for fast demos or OPENAI_API_KEY (Gemini) for extraction + embeddings."}
          </p>
          <form action={signOut} className="mt-5">
            <SubmitButton variant="secondary">
              Sign out
            </SubmitButton>
          </form>
        </Card>

        <Card className="p-6">
          <h2 className="text-base font-medium">Timezone</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Used for deadline labels and in-app reminders when an application does not set its own timezone.
          </p>
          <form action={updateTimezone} className="mt-4 grid gap-3">
            <Field label="IANA timezone" htmlFor="account-timezone">
              <Input
                id="account-timezone"
                name="timezone"
                defaultValue={profile?.timezone ?? ""}
                placeholder="Asia/Karachi"
              />
            </Field>
            <SubmitButton variant="secondary">
              Save timezone
            </SubmitButton>
          </form>
        </Card>

        <Card className="p-6" data-tour="settings-freeze">
          <h2 className="text-base font-medium">Prepare and send if I don’t respond</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Off by default. When on, Dashboard shows the packet that will freeze at the deadline unless you edit.
            1-Apply never clicks host Submit, and never bypasses CAPTCHA, signature, or payment.
          </p>
          <form action={updatePrepareAndSend} className="mt-4 grid gap-3">
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                name="prepareAndSendIfSilent"
                defaultChecked={prefs.prepareAndSendIfSilent}
                className="mt-1"
              />
              <span>Freeze this packet at the deadline if I stay silent. Email/in-app notice goes out first.</span>
            </label>
            <SubmitButton variant="secondary">
              Save send preference
            </SubmitButton>
          </form>
        </Card>

        <Card className="p-6">
          <h2 className="text-base font-medium">Browser extension</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Connect Gmail or Calendar from{" "}
            <a className="underline" href="/app/integrations">
              Integrations
            </a>
            . The extension never clicks submit.
          </p>
          <ExtensionConnectCard appUrl={appUrl} />
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
            <SubmitButton variant="secondary">
              Delete my data
            </SubmitButton>
          </form>
        </Card>
      </div>
    </WorkspaceMain>
  );
}
