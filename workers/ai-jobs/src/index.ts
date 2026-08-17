import { toJobLifecycle, type JobLifecycle, type JobType } from "@1apply/contracts";

export type JobRow = {
  id: string;
  user_id: string;
  type: JobType;
  state: string;
  attempts: number;
  max_attempts: number;
  input_ref: string;
  error_code: string | null;
};

export type JobProcessor = {
  type: JobType;
  run: (job: JobRow) => Promise<void>;
};

export function selectRunnableJobs<T extends { state: string; next_attempt_at?: string | null }>(
  jobs: T[],
  now = new Date(),
): T[] {
  return jobs.filter((job) => {
    const lifecycle: JobLifecycle = toJobLifecycle(job.state as Parameters<typeof toJobLifecycle>[0]);
    if (lifecycle !== "queued") return false;
    if (!job.next_attempt_at) return true;
    return new Date(job.next_attempt_at) <= now;
  });
}

export async function processJob(processors: JobProcessor[], job: JobRow): Promise<"completed" | "failed"> {
  const processor = processors.find((item) => item.type === job.type);
  if (!processor) return "failed";
  await processor.run(job);
  return "completed";
}
