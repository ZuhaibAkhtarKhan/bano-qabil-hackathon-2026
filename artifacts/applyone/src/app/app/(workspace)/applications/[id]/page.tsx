import { notFound } from "next/navigation";

import { ApplicationWorkspace } from "@/components/app/application-workspace";
import { loadApplicationWorkspace } from "@/server/workspace/queries";

export default async function ApplicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { id } = await params;
  const { notice, error } = await searchParams;
  const data = await loadApplicationWorkspace(id);
  if (!data) notFound();

  return <ApplicationWorkspace data={data} notice={notice} error={error} />;
}
