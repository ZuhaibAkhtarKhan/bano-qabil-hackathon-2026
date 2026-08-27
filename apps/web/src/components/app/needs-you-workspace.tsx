import Link from "next/link";

import { needsYouKindLabel, type NeedsYouItem } from "@/lib/needs-you";
import { resolveNeedsYouDocument, resolveNeedsYouValue } from "@/server/needs-you/actions";
import type { NeedsYouDocumentOption, NeedsYouQueue } from "@/server/needs-you/queries";
import { SubmitButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";

function groupByApplication(items: NeedsYouItem[]) {
  const groups = new Map<
    string,
    { applicationId: string; href: string; company: string; role: string; items: NeedsYouItem[] }
  >();
  for (const item of items) {
    const existing = groups.get(item.applicationId);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    groups.set(item.applicationId, {
      applicationId: item.applicationId,
      href: item.applicationHref,
      company: item.company,
      role: item.role,
      items: [item],
    });
  }
  return [...groups.values()];
}

/** Text questions: Save to memory (platform-wide) or fill this application only. */
function QuestionForm({ item }: { item: NeedsYouItem }) {
  const inputId = `${item.id}-value`;
  return (
    <form action={resolveNeedsYouValue} className="grid gap-3">
      <input type="hidden" name="applicationId" value={item.applicationId} />
      <input type="hidden" name="label" value={item.title} />
      <input type="hidden" name="detail" value={item.detail ?? ""} />
      {item.payload.profileField ? (
        <input type="hidden" name="profileField" value={item.payload.profileField} />
      ) : null}
      {item.payload.reviewItemId ? (
        <input type="hidden" name="reviewItemId" value={item.payload.reviewItemId} />
      ) : null}
      {item.payload.questionId ? (
        <input type="hidden" name="questionId" value={item.payload.questionId} />
      ) : null}
      {item.payload.answerId ? (
        <input type="hidden" name="answerId" value={item.payload.answerId} />
      ) : null}
      {item.payload.mappingId ? (
        <input type="hidden" name="mappingId" value={item.payload.mappingId} />
      ) : null}

      <Field label="Your answer" htmlFor={inputId}>
        {item.inputType === "textarea" ? (
          <Textarea
            id={inputId}
            name="value"
            required
            rows={item.kind === "answer" ? 5 : 4}
            placeholder="Enter the value for this question…"
          />
        ) : (
          <Input
            id={inputId}
            name="value"
            type={item.inputType === "date" ? "date" : "text"}
            required
            placeholder="Enter the value for this question…"
          />
        )}
      </Field>

      <div className="flex flex-wrap gap-2">
        <SubmitButton name="scope" value="memory" pendingText="Saving to memory…">
          Save to memory
        </SubmitButton>
        <SubmitButton
          name="scope"
          value="application"
          variant="secondary"
          pendingText="Filling application…"
        >
          Fill just for this application
        </SubmitButton>
      </div>
      <p className="text-xs leading-5 text-ink-muted">
        <span className="font-medium text-ink">Save to memory</span> keeps this for every future
        application.{" "}
        <span className="font-medium text-ink">Fill just for this application</span> uses it only
        here and does not update Application Memory.
      </p>
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
  return (
    <form action={resolveNeedsYouDocument} className="grid gap-3" encType="multipart/form-data">
      <input type="hidden" name="applicationId" value={item.applicationId} />
      <input type="hidden" name="requiredLabel" value={item.payload.requiredLabel ?? item.title} />
      <Field label="Attach from Application Memory" htmlFor={`${item.id}-doc`}>
        <Select id={`${item.id}-doc`} name="documentId" defaultValue="">
          <option value="">Select a document…</option>
          {documents.map((doc) => (
            <option key={doc.id} value={doc.id} disabled={!doc.currentVersionId}>
              {doc.label} ({doc.type})
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Or upload a new file"
        htmlFor={`${item.id}-file`}
        hint="Stored in Application Memory, then attached to this application."
      >
        <Input
          id={`${item.id}-file`}
          name="file"
          type="file"
          accept=".pdf,.doc,.docx,.txt,.md,application/pdf"
        />
      </Field>
      <SubmitButton pendingText="Attaching…">Attach document</SubmitButton>
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
  return (
    <article className="rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={item.kind === "document" ? "sand" : item.kind === "answer" ? "teal" : "coral"}>
          {needsYouKindLabel(item.kind)}
        </StatusPill>
      </div>
      <h3 className="mt-3 text-base font-semibold leading-snug">{item.title}</h3>
      <div className="mt-4">
        {item.kind === "document" ? (
          <DocumentForm item={item} documents={documents} />
        ) : (
          <QuestionForm item={item} />
        )}
      </div>
    </article>
  );
}

export function NeedsYouWorkspace({ data }: { data: NeedsYouQueue }) {
  const groups = groupByApplication(data.items);

  if (data.items.length === 0) {
    return (
      <div className="mt-10">
        <EmptyState
          eyebrow="Caught up"
          title="Nothing needs you right now"
          body="When an application is missing a fact, answer, document, or form field that Application Memory does not have, it shows up here."
        />
      </div>
    );
  }

  return (
    <div className="mt-8 grid gap-8">
      <div className="flex flex-wrap gap-2">
        <StatusPill tone="coral">{data.counts.total} waiting</StatusPill>
        {Object.entries(data.counts.byKind).map(([kind, count]) => (
          <StatusPill key={kind} tone="muted">
            {needsYouKindLabel(kind as NeedsYouItem["kind"])}: {count}
          </StatusPill>
        ))}
      </div>

      {groups.map((group) => (
        <section key={group.applicationId} className="grid gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-muted">
                Required by
              </p>
              <h2 className="mt-1 font-display text-2xl leading-tight">
                {group.role}
                <span className="text-ink-muted"> · {group.company}</span>
              </h2>
            </div>
            <Link
              href={group.href}
              className="text-sm font-medium text-ink-muted underline-offset-4 hover:text-ink hover:underline"
            >
              Open application
            </Link>
          </div>
          <ul className="grid gap-4">
            {group.items.map((item) => (
              <li key={item.id}>
                <ItemCard item={item} documents={data.documents} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
