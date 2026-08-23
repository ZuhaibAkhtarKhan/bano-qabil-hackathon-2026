"use client";

import { useEffect, useState } from "react";
import type { JobLifecycle } from "@1apply/contracts";

export type RealtimeJobStatus = {
  id: string | null;
  state: JobLifecycle | "idle";
  isRunning: boolean;
  isCompleted: boolean;
  isFailed: boolean;
  attempts: number;
  errorCode: string | null;
};

export function useRealtimeJob(jobId: string | null | undefined): RealtimeJobStatus {
  const [status, setStatus] = useState<RealtimeJobStatus>({
    id: jobId ?? null,
    state: jobId ? "queued" : "idle",
    isRunning: Boolean(jobId),
    isCompleted: false,
    isFailed: false,
    attempts: 0,
    errorCode: null,
  });

  useEffect(() => {
    if (!jobId) {
      setStatus({
        id: null,
        state: "idle",
        isRunning: false,
        isCompleted: false,
        isFailed: false,
        attempts: 0,
        errorCode: null,
      });
      return;
    }

    let active = true;
    let pollTimeout: NodeJS.Timeout | null = null;

    async function checkJob() {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) {
          if (res.status === 404 && active) {
            // Might not be written yet, retry in 1s
            pollTimeout = setTimeout(checkJob, 1000);
            return;
          }
          throw new Error("JOB_FETCH_FAILED");
        }

        const json = (await res.json()) as {
          data: {
            id: string;
            type: string;
            state: JobLifecycle;
            attempts: number;
            errorCode: string | null;
          } | null;
        };

        if (json.data && active) {
          const state = json.data.state;
          const isCompleted = state === "completed";
          const isFailed = state === "failed";
          const isRunning = state === "queued" || state === "processing";

          setStatus({
            id: json.data.id,
            state,
            isRunning,
            isCompleted,
            isFailed,
            attempts: json.data.attempts,
            errorCode: json.data.errorCode,
          });

          if (isRunning) {
            pollTimeout = setTimeout(checkJob, 1000);
          }
        }
      } catch {
        if (active) {
          pollTimeout = setTimeout(checkJob, 2000);
        }
      }
    }

    void checkJob();

    return () => {
      active = false;
      if (pollTimeout) clearTimeout(pollTimeout);
    };
  }, [jobId]);

  return status;
}
