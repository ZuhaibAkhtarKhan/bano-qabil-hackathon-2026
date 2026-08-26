import Link from "next/link";

import { needsYouKindLabel, type NeedsYouItem } from "@/lib/needs-you";
import {
  dismissNeedsYouReview,
  resolveNeedsYouAnswer,
  resolveNeedsYouDocument,
  resolveNeedsYouMemory,
} from "@/server/needs-you/actions";
import type { NeedsYouDocumentOption, NeedsYouQueue } from "@/server/needs-you/queries";
import { Button } from "@/components/ui/button";
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

function MemoryForm({ item }: { item: NeedsYouItem }) {
  return (
    <form action={resolveNeedsYouMemory} className="grid gap-3">
      <input type="hidden" name="applicationId" value={item.applicationId} />
      <input type="hidden" name="label" value={item.title} />
      {item.payload.profileField ? (
        <input type="hidden" name="profileField" value={item.payload.profileField} />
      ) : null}
      {item.payload.reviewItemId ? (
        <input type="hidden" name="reviewItemId" value={item.payload.reviewItemId} />
      ) : null}
      {item.payload.questionId ? (
        <input type="hidden" name="questionId" value={item.payload.questionId} />
      ) : null}
      {item.payload.mappingId ? (
        <input type="hidden" name="mappingId" value={item.payload.mappingId} />
      ) : null}
      <Field label={item.inputLabel} htmlFor={`${item.id}-value`}>
        {item.inputType === "textarea" ? (
          <Textarea id={`${item.id}-value`} name="value" required rows={4} placeholder="Write the missing information…" />
        ) : (
          <Input
            id={`${item.id}-value`}
            name="value"
            type={item.inputType === "date" ? "date" : "text"}
            required
            placeholder="Enter the value Application Memory should keep"
          />
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit">Save to memory & continue</Button>
      </div>
    </form>
  );
}

function ReviewActions({ item }: { item: NeedsYouItem }) {
  if (!item.payload.reviewItemId) return null;
  return (
    <form action={dismissNeedsYouReview} className="mt-2">
      <input type="hidden" name="applicationId" value={item.applicationId} />
      <input type="hidden" name="reviewItemId" value={item.payload.reviewItemId} />
      <Button type="submit" variant="secondary">
        Mark resolved without new fact
      </Button>
    </form>
  );
}

function AnswerForm({ item }: { item: NeedsYouItem }) {
  return (
    <form action={resolveNeedsYouAnswer} className="grid gap-3">
      <input type="hidden" name="applicationId" value={item.applicationId} />
      <input type="hidden" name="questionId" value={item.payload.questionId ?? ""} />
      <input type="hidden" name="answerId" value={item.payload.answerId ?? ""} />
      <Field label={item.inputLabel} htmlFor={`${item.id}-answer`}>
        <Textarea
          id={`${item.id}-answer`}
          name="value"
          required
          rows={5}
          placeholder="Write your answer. It is saved to Application Memory and approved for this application."
        />
      </Field>
      <Button type="submit">Save answer & continue</Button>
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
      <Field label="Or upload a new file" htmlFor={`${item.id}-file`} hint="Stored in Application Memory, then attached.">
        <Input id={`${item.id}-file`} name="file" type="file" accept=".pdf,.doc,.docx,.txt,.md,application/pdf" />
      </Field>
      <Button type="submit">Attach & continue</Button>
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
        {item.payload.profileField ? <StatusPill tone="mint">Memory field</StatusPill> : null}
      </div>
      <h3 className="mt-3 text-base font-semibold leading-snug">{item.title}</h3>
      {item.detail ? <p className="mt-2 text-sm leading-6 text-ink-muted">{item.detail}</p> : null}
      <div className="mt-4">
        {item.kind === "answer" ? (
          <AnswerForm item={item} />
        ) : item.kind === "document" ? (
          <DocumentForm item={item} documents={documents} />
        ) : (
          <>
            <MemoryForm item={item} />
            {item.kind === "review" ? <ReviewActions item={item} /> : null}
          </>
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
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-muted">Required by</p>
              <h2 className="mt-1 font-display text-2xl leading-tight">
                {group.role}
                <span className="text-ink-muted"> · {group.company}</span>
              </h2>
            </div>
            <Link href={group.href} className="text-sm font-medium text-ink-muted underline-offset-4 hover:text-ink hover:underline">
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
