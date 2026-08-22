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
  correlation_id?: string | null;
  next_attempt_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type JobProcessor = {
  type: JobType;
  run: (job: JobRow) => Promise<void>;
};

export type JobHandler = (job: JobRow) => Promise<void>;

export function createProcessor(type: JobType, run: JobHandler): JobProcessor {
  return { type, run };
}

export class JobRegistry {
  private processors = new Map<JobType, JobProcessor>();

  register(processor: JobProcessor): this {
    this.processors.set(processor.type, processor);
    return this;
  }

  registerHandler(type: JobType, run: JobHandler): this {
    return this.register(createProcessor(type, run));
  }

  get(type: JobType): JobProcessor | undefined {
    return this.processors.get(type);
  }

  has(type: JobType): boolean {
    return this.processors.has(type);
  }

  list(): JobProcessor[] {
    return Array.from(this.processors.values());
  }
}

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

export async function processJob(
  processors: JobProcessor[] | JobRegistry,
  job: JobRow,
): Promise<"completed" | "failed"> {
  const processor =
    processors instanceof JobRegistry
      ? processors.get(job.type)
      : processors.find((item) => item.type === job.type);

  if (!processor) return "failed";

  try {
    await processor.run(job);
    return "completed";
  } catch {
    return "failed";
  }
}

export type WorkerCycleOptions = {
  fetchQueuedJobs: () => Promise<JobRow[]>;
  onJobStarted?: (job: JobRow) => Promise<void>;
  onJobCompleted?: (job: JobRow) => Promise<void>;
  onJobFailed?: (job: JobRow, error: unknown) => Promise<void>;
  now?: () => Date;
};

export async function runWorkerCycle(
  registry: JobRegistry | JobProcessor[],
  options: WorkerCycleOptions,
): Promise<{ processed: number; succeeded: number; failed: number }> {
  const rawJobs = await options.fetchQueuedJobs();
  const runnable = selectRunnableJobs(rawJobs, options.now?.() ?? new Date());

  let succeeded = 0;
  let failed = 0;

  for (const job of runnable) {
    try {
      await options.onJobStarted?.(job);
      const result = await processJob(registry, job);
      if (result === "completed") {
        succeeded += 1;
        await options.onJobCompleted?.(job);
      } else {
        failed += 1;
        await options.onJobFailed?.(job, new Error(`No processor found for job type: ${job.type}`));
      }
    } catch (err) {
      failed += 1;
      await options.onJobFailed?.(job, err);
    }
  }

  return { processed: runnable.length, succeeded, failed };
}
