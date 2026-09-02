import Link from "next/link";

import { NeedsYouDeleteApplication } from "@/components/app/needs-you-delete-application";
import { NeedsYouEligibilityConfirm } from "@/components/app/needs-you-eligibility-confirm";
import { NeedsYouQuestionForm } from "@/components/app/needs-you-question-form";
import { needsYouKindLabel, type NeedsYouItem } from "@/lib/needs-you";
import { resolveNeedsYouDeadline, resolveNeedsYouDocument } from "@/server/needs-you/actions";
import type {
  NeedsYouApplicationGroup,
  NeedsYouDocumentOption,
  NeedsYouQueue,
  NeedsYouWallInfo,
} from "@/server/needs-you/queries";
import { SubmitButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";

function DeadlineForm({ item }: { item: NeedsYouItem }) {
  return (
    <form action={resolveNeedsYouDeadline} className="grid gap-3">
      <input type="hidden" name="applicationId" value={item.applicationId} />
      <Field label="Deadline" htmlFor={`${item.id}-deadline`} hint="Date and time the application closes">
        <Input id={`${item.id}-deadline`} name="deadline" type="datetime-local" required />
      </Field>
      <Field
        label="Timezone (optional)"
        htmlFor={`${item.id}-tz`}
        hint="IANA name, for example Asia/Karachi"
      >
        <Input
          id={`${item.id}-tz`}
          name="timezone"
          defaultValue={item.payload.timezone ?? ""}
          placeholder="Asia/Karachi"
        />
      </Field>
      <SubmitButton pendingText="Saving deadline…">Save deadline</SubmitButton>
    </form>
  );
}

function DocumentForm({
  item,
  documents,
}: {
  item: NeedsYouItem;
  documents: NeedsYouDocumentOption[];
}) {
  const isImage = item.inputType === "image" || item.payload.uploadKind === "image";
  const status = item.payload.documentStatus ?? "attach";
  const accept = isImage
    ? "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
    : ".pdf,.doc,.docx,.txt,.md,application/pdf";
  const vaultDocs = isImage
    ? documents.filter((doc) => /image|photo|png|jpe?g|webp|headshot|portrait/i.test(`${doc.label} ${doc.type}`))
    : /resume|cv/i.test(item.title) || status === "not_best_fit"
      ? documents.filter((doc) => /resume/i.test(doc.type) || /resume|cv/i.test(doc.label))
      : documents;
  const shownDocs = vaultDocs.length > 0 ? vaultDocs : documents;
  const recommendedId = item.payload.recommendedDocumentId ?? "";
  const defaultDoc =
    recommendedId && shownDocs.some((doc) => doc.id === recommendedId)
      ? recommendedId
      : shownDocs.find((doc) => doc.currentVersionId)?.id ?? "";

  if (status === "unavailable" && shownDocs.length === 0) {
    return (
      <form action={resolveNeedsYouDocument} className="grid gap-3" encType="multipart/form-data">
        <input type="hidden" name="applicationId" value={item.applicationId} />
        <input type="hidden" name="requiredLabel" value={item.payload.requiredLabel ?? item.title} />
        <input type="hidden" name="uploadKind" value={isImage ? "image" : "document"} />
        {item.payload.mappingId ? (
          <input type="hidden" name="mappingId" value={item.payload.mappingId} />
        ) : null}
        {item.payload.eligibilityId ? (
          <input type="hidden" name="eligibilityId" value={item.payload.eligibilityId} />
        ) : null}
        <p className="rounded-xl border border-dashed border-line bg-[#f7f8f4] px-3.5 py-3 text-sm text-ink-muted">
          Nothing matching this requirement is in Application Memory yet.
        </p>
        <Field
          label={isImage ? "Upload a new image" : "Upload a new file"}
          htmlFor={`${item.id}-file`}
          hint="Stored in Application Memory, then attached to this application."
        >
          <Input id={`${item.id}-file`} name="file" type="file" accept={accept} required />
        </Field>
        <SubmitButton pendingText="Uploading…">{isImage ? "Upload image" : "Upload document"}</SubmitButton>
      </form>
    );
  }

  return (
    <form action={resolveNeedsYouDocument} className="grid gap-3" encType="multipart/form-data">
      <input type="hidden" name="applicationId" value={item.applicationId} />
      <input type="hidden" name="requiredLabel" value={item.payload.requiredLabel ?? item.title} />
      <input type="hidden" name="uploadKind" value={isImage ? "image" : "document"} />
      {item.payload.mappingId ? (
        <input type="hidden" name="mappingId" value={item.payload.mappingId} />
      ) : null}
      {item.payload.eligibilityId ? (
        <input type="hidden" name="eligibilityId" value={item.payload.eligibilityId} />
      ) : null}
      {status === "not_best_fit" && item.payload.recommendedDocumentLabel ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3.5 py-3 text-sm text-amber-950">
          <p className="font-medium">
            Best available: {item.payload.recommendedDocumentLabel}
            {typeof item.payload.fitScore === "number" ? ` (${item.payload.fitScore}% fit)` : ""}
          </p>
          <p className="mt-1 text-xs text-amber-900/80">
            Approve this resume anyway, or upload a better-targeted file. If you don’t, the platform will attach this
            best fit before the application deadline.
          </p>
        </div>
      ) : null}
      <Field
        label={isImage ? "Attach an image from Application Memory" : "Attach from Application Memory"}
        htmlFor={`${item.id}-doc`}
      >
        <Select id={`${item.id}-doc`} name="documentId" defaultValue={defaultDoc}>
          <option value="">{isImage ? "Select an image…" : "Select a document…"}</option>
          {shownDocs.map((doc) => (
            <option key={doc.id} value={doc.id} disabled={!doc.currentVersionId}>
              {doc.displayLabel || doc.label}
              {doc.id === recommendedId ? " — recommended" : ""}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label={
          status === "not_best_fit"
            ? "Or upload a better-targeted file"
            : isImage
              ? "Or upload a new image"
              : "Or upload a new file"
        }
        htmlFor={`${item.id}-file`}
        hint={
          isImage
            ? "JPEG, PNG, or WebP. Stored in Application Memory, then attached to this application."
            : "Stored in Application Memory, then attached to this application."
        }
      >
        <Input id={`${item.id}-file`} name="file" type="file" accept={accept} />
      </Field>
      <SubmitButton
        pendingText={
          status === "not_best_fit" ? "Approving…" : isImage ? "Attaching image…" : "Attaching…"
        }
      >
        {status === "not_best_fit"
          ? "Use this resume anyway"
          : isImage
            ? "Attach image"
            : "Attach document"}
      </SubmitButton>
    </form>
  );
}

function ItemCard({
  item,
  documents,
}: {
  item: NeedsYouItem;
  documents: NeedsYouDocumentOption[];
}) {
  const isUpload = item.kind === "document" || item.inputType === "document" || item.inputType === "image";
  const isDeadline = item.kind === "deadline";
  const isEligibility = item.kind === "eligibility";
  const confirmEligible = item.payload.confirmEligible === true;
  const canEdit =
    Boolean(item.payload.profileField || item.payload.mappingId || item.payload.questionId) ||
    (!isEligibility && !isUpload && !isDeadline);
  const eligibilityIssue = item.payload.eligibilityIssue?.trim() || null;
  const eligibilityRequirement = item.payload.eligibilityRequirement?.trim() || null;
  const documentStatus = item.payload.documentStatus;

  return (
    <article className="rounded-xl border border-line bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill
          tone={
            isDeadline
              ? "coral"
              : item.inputType === "image"
                ? "mint"
                : documentStatus === "not_best_fit"
                  ? "sand"
                  : documentStatus === "unavailable"
                    ? "coral"
                    : item.kind === "document"
                      ? "sand"
                      : item.inputType === "multi-select"
                        ? "mint"
                        : item.inputType === "select"
                          ? "teal"
                          : item.kind === "answer"
                            ? "teal"
                            : item.kind === "eligibility"
                              ? "coral"
                              : "coral"
          }
        >
          {isDeadline
            ? "Deadline needed"
            : item.inputType === "image"
              ? "Image upload"
              : item.inputType === "multi-select"
                ? "Multi-select"
                : item.inputType === "select"
                  ? "Choose option"
                  : documentStatus === "not_best_fit"
                    ? "Resume not best fit"
                    : documentStatus === "unavailable"
                      ? "Document unavailable"
                      : item.kind === "document"
                        ? "Document"
                        : needsYouKindLabel(item.kind)}
        </StatusPill>
        {!item.required ? <StatusPill tone="muted">Optional</StatusPill> : null}
        {typeof item.payload.fitScore === "number" && documentStatus === "not_best_fit" ? (
          <StatusPill tone="muted">{item.payload.fitScore}% fit</StatusPill>
        ) : null}
      </div>
      <h3 className="mt-3 text-base font-semibold leading-snug">{item.title}</h3>
      {item.detail && !eligibilityIssue ? <p className="mt-2 text-sm text-ink-muted">{item.detail}</p> : null}

      {isEligibility && (eligibilityIssue || eligibilityRequirement) ? (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50/70 px-3.5 py-3 text-sm text-rose-950">
          <p className="font-medium">Eligibility problem</p>
          {eligibilityRequirement ? (
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-rose-800/80">
              Requirement: {eligibilityRequirement}
            </p>
          ) : null}
          {eligibilityIssue ? <p className="mt-1.5 leading-relaxed text-rose-900/90">{eligibilityIssue}</p> : null}
          {item.detail ? <p className="mt-2 text-xs text-rose-900/70">{item.detail}</p> : null}
        </div>
      ) : null}

      <div className="mt-4">
        {isDeadline ? (
          <DeadlineForm item={item} />
        ) : isUpload ? (
          <DocumentForm item={item} documents={documents} />
        ) : canEdit ? (
          <NeedsYouQuestionForm item={item} />
        ) : confirmEligible && item.payload.eligibilityId ? (
          <NeedsYouEligibilityConfirm
            applicationId={item.applicationId}
            eligibilityId={item.payload.eligibilityId}
          />
        ) : (
          <p className="text-sm text-ink-muted">
            There is no single answer to edit for this blocker. If you are not eligible, remove the
            application below.
          </p>
        )}
      </div>

      {item.payload.allowDeleteApplication ? (
        <NeedsYouDeleteApplication applicationId={item.applicationId} />
      ) : null}
    </article>
  );
}

function wallChips(walls: NeedsYouWallInfo) {
  const chips: Array<{ key: string; label: string; tone: "coral" | "sand" | "muted" }> = [];
  if (walls.captcha) {
    chips.push({
      key: "captcha",
      label: walls.captchaMessage?.trim() || "Captcha",
      tone: "coral",
    });
  }
  if (walls.accountCreation) {
    chips.push({
      key: "sign-on",
      label: walls.accountMessage?.trim() || "Sign-on / account",
      tone: "sand",
    });
  }
  if (walls.unsupported) {
    chips.push({
      key: "unsupported",
      label: walls.unsupportedReason?.trim() || "Unsupported wall",
      tone: "muted",
    });
  }
  if (walls.originHost) {
    chips.push({ key: "host", label: walls.originHost, tone: "muted" });
  }
  return chips;
}

function ApplicationNeedsRow({
  group,
  documents,
}: {
  group: NeedsYouApplicationGroup;
  documents: NeedsYouDocumentOption[];
}) {
  const walls = wallChips(group.walls);
  const fieldLabel = group.fieldCount === 1 ? "1 field needs input" : `${group.fieldCount} fields need input`;

  return (
    <details className="group border-b border-line last:border-b-0">
      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3.5 hover:bg-[#fafbf8]/60 [&::-webkit-details-marker]:hidden">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-white text-xs font-semibold text-ink">
          {group.initial}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate font-medium leading-tight text-ink">{group.company}</span>
            {group.sourceLabel ? (
              <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                {group.sourceLabel}
              </span>
            ) : null}
            <span className="ml-auto shrink-0 font-mono text-[11px] text-ink-muted transition group-open:rotate-90">
              ›
            </span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink-muted">{group.role}</span>
          <span className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" aria-hidden="true" />
              {fieldLabel}
            </span>
            {walls.map((chip) => (
              <span
                key={chip.key}
                title={chip.label}
                className={
                  chip.tone === "coral"
                    ? "max-w-[14rem] truncate rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-800"
                    : chip.tone === "sand"
                      ? "max-w-[14rem] truncate rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900"
                      : "max-w-[14rem] truncate rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-700"
                }
              >
                {chip.label}
              </span>
            ))}
          </span>
        </span>
      </summary>
      <div className="border-t border-line bg-[#fafbf8]/40 px-4 py-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink-muted">Answer each item below, then reopen the form to continue filling.</p>
          <Link href={group.href} className="text-sm font-medium text-ink-muted hover:text-ink">
            Open application →
          </Link>
        </div>
        <div className="grid gap-3">
          {group.items.map((item) => (
            <ItemCard key={item.id} item={item} documents={documents} />
          ))}
        </div>
      </div>
    </details>
  );
}

export function NeedsYouWorkspace({ data }: { data: NeedsYouQueue }) {
  const groups = data.groups.length > 0 ? data.groups : [];

  if (data.items.length === 0) {
    return (
      <div className="mt-10" data-tour="needs-you-queue">
        <EmptyState
          eyebrow="Caught up"
          title="Nothing needs you right now"
          body="When an application is missing a fact, answer, document, image, or form choice that Application Memory does not have, it shows up here."
        />
      </div>
    );
  }

  return (
    <div className="mt-8 grid gap-6" data-tour="needs-you-queue">
      <div className="flex flex-wrap gap-2">
        <StatusPill tone="coral">{data.counts.total} waiting</StatusPill>
        <StatusPill tone="muted">
          {groups.length} {groups.length === 1 ? "application" : "applications"}
        </StatusPill>
        {Object.entries(data.counts.byKind).map(([kind, count]) => (
          <StatusPill key={kind} tone="muted">
            {needsYouKindLabel(kind as NeedsYouItem["kind"])}: {count}
          </StatusPill>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="border-b border-line bg-[#fafbf8] px-4 py-3 text-[11px] uppercase tracking-wider text-ink-muted">
          Applications that need input
        </div>
        {groups.map((group) => (
          <ApplicationNeedsRow key={group.applicationId} group={group} documents={data.documents} />
        ))}
      </div>
    </div>
  );
}
