"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { Button, SubmitButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { markNotificationReadAction } from "@/server/notifications/actions";
import type { NotificationRow } from "@/server/types";

export function NotificationsInbox({ notifications }: { notifications: NotificationRow[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");

  const categories = useMemo(
    () => Array.from(new Set(notifications.map((item) => item.category).filter(Boolean))) as string[],
    [notifications],
  );

  const unread = notifications.filter((item) => !item.read_at).length;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return notifications.filter((item) => {
      const haystack = [item.title, item.body, item.category].filter(Boolean).join(" ").toLowerCase();
      if (needle && !haystack.includes(needle)) return false;
      if (status === "unread" && item.read_at) return false;
      if (status === "read" && !item.read_at) return false;
      if (category && item.category !== category) return false;
      return true;
    });
  }, [notifications, query, status, category]);

  return (
    <div className="mt-8 max-w-2xl">
      <Card className="mb-6 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Search" htmlFor="q">
            <Input
              id="q"
              value={query}
              placeholder="Search notices…"
              onChange={(event) => setQuery(event.target.value)}
            />
          </Field>
          <Field label="Status" htmlFor="status">
            <Select id="status" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All</option>
              <option value="unread">Unread only</option>
              <option value="read">Read only</option>
            </Select>
          </Field>
          <Field label="Category" htmlFor="category">
            <Select id="category" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">All categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-2 sm:col-span-3">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                setQuery("");
                setStatus("");
                setCategory("");
              }}
            >
              Reset
            </Button>
          </div>
        </div>
      </Card>

      <p className="mb-6 text-sm text-ink-muted">
        {unread} unread · {filtered.length} showing of {notifications.length} total
      </p>

      {filtered.length === 0 ? (
        <EmptyState
          eyebrow="No matches"
          title="No notifications match the filter"
          body="Try clearing search or status filters."
        />
      ) : (
        <ul className="grid gap-3">
          {filtered.map((item) => {
            const href = item.action_url || (item.application_id ? `/app/applications/${item.application_id}` : null);
            return (
              <li key={item.id} className="rounded-2xl border border-line bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{item.title}</p>
                    <p className="mt-1 text-sm text-ink-muted">{item.body}</p>
                    <p className="mt-2 text-xs text-ink-muted">
                      {item.category ? item.category.replace(/_/g, " ") : "notice"}
                      {typeof item.priority === "number" ? ` · priority ${item.priority}` : ""}
                      {" · "}
                      {new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
                        new Date(item.created_at),
                      )}
                    </p>
                  </div>
                  <StatusPill tone={item.read_at ? "muted" : "sand"}>{item.read_at ? "Read" : "Unread"}</StatusPill>
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-sm">
                  {href ? (
                    <Link className="underline" href={href}>
                      Open
                    </Link>
                  ) : null}
                  {!item.read_at ? (
                    <form action={markNotificationReadAction}>
                      <input type="hidden" name="notificationId" value={item.id} />
                      <SubmitButton variant="ghost" size="sm" className="h-auto px-0 py-0 underline" pendingText="Updating…">
                        Mark read
                      </SubmitButton>
                    </form>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
