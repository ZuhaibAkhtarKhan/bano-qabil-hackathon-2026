import { isPostDeadlineHostSubmitKey } from "@1apply/domain";

export type HostJobLite = {
  status: string;
  job_kind?: string | null;
  host_submit_clicked?: boolean | null;
  last_error?: string | null;
  idempotency_key?: string | null;
};

export type HostSubmitAttemptState = {
  applicationSubmitted: boolean;
  hostSubmitSucceeded: boolean;
  hostSubmitClicked: boolean;
  waitingNeedsYou: boolean;
  firstSubmitAttemptFinished: boolean;
  postDeadlineAttempted: boolean;
  hasNonPostAutoSubmitJob: boolean;
};

const TERMINAL_ATTEMPT = new Set(["submitted", "failed", "blocked", "cancelled"]);

export function isManualHostSubmitKey(idempotencyKey: string | null | undefined): boolean {
  return Boolean(idempotencyKey && idempotencyKey.includes(":host_submit:manual:"));
}

function isAutoSubmitJob(job: HostJobLite): boolean {
  if (String(job.job_kind ?? "submit") !== "submit") return false;
  if (isPostDeadlineHostSubmitKey(job.idempotency_key)) return false;
  if (isManualHostSubmitKey(job.idempotency_key)) return false;
  return true;
}

function isWaitingNeedsYou(job: HostJobLite): boolean {
  return String(job.status) === "completed" && String(job.last_error ?? "") === "waiting_needs_you" && !job.host_submit_clicked;
}

export function summarizeHostSubmitJobs(
  jobs: HostJobLite[],
  application: { status?: string | null; submitted_at?: string | null },
): HostSubmitAttemptState {
  const applicationSubmitted =
    String(application.status ?? "") === "submitted" || Boolean(application.submitted_at);
  const hostSubmitSucceeded =
    applicationSubmitted || jobs.some((job) => String(job.status) === "submitted");
  const hostSubmitClicked = jobs.some((job) => Boolean(job.host_submit_clicked));
  const waitingNeedsYou = jobs.some(
    (job) => isWaitingNeedsYou(job) && String(job.job_kind ?? "submit") === "submit",
  );
  const firstSubmitAttemptFinished = jobs.some((job) => {
    if (!isAutoSubmitJob(job)) return false;
    if (isWaitingNeedsYou(job)) return false;
    const status = String(job.status);
    return TERMINAL_ATTEMPT.has(status) || status === "completed";
  });
  const postDeadlineAttempted = jobs.some(
    (job) =>
      isPostDeadlineHostSubmitKey(job.idempotency_key) &&
      (TERMINAL_ATTEMPT.has(String(job.status)) || String(job.status) === "completed"),
  );
  const hasNonPostAutoSubmitJob = jobs.some((job) => isAutoSubmitJob(job));

  return {
    applicationSubmitted,
    hostSubmitSucceeded,
    hostSubmitClicked,
    waitingNeedsYou,
    firstSubmitAttemptFinished,
    postDeadlineAttempted,
    hasNonPostAutoSubmitJob,
  };
}

/** Continue page-fill after Need You only if we have not already submitted or clicked Submit. */
export function shouldContinueHostFill(state: HostSubmitAttemptState): boolean {
  if (state.hostSubmitSucceeded || state.applicationSubmitted) return false;
  if (state.hostSubmitClicked) return false;
  return true;
}

/** Page-loop may click Submit only on the first automatic attempt. */
export function shouldClickSubmitOnContinue(state: HostSubmitAttemptState): boolean {
  if (!shouldContinueHostFill(state)) return false;
  if (state.firstSubmitAttemptFinished) return false;
  return true;
}

/** Create a new auto-submit job key (deadline / no-deadline). Do not add a second submit path. */
export function shouldCreateNewAutoSubmitJob(state: HostSubmitAttemptState): boolean {
  if (!shouldClickSubmitOnContinue(state)) return false;
  if (state.hasNonPostAutoSubmitJob) return false;
  return true;
}

/** @deprecated use shouldCreateNewAutoSubmitJob — kept for callers that queue the first submit. */
export function shouldAutoQueueHostSubmit(state: HostSubmitAttemptState): boolean {
  return shouldCreateNewAutoSubmitJob(state);
}

/** Exactly one post-deadline retry, and only if the first automatic submit failed. */
export function shouldQueuePostDeadlineRetry(state: HostSubmitAttemptState): boolean {
  if (state.hostSubmitSucceeded || state.applicationSubmitted) return false;
  if (state.postDeadlineAttempted) return false;
  return state.firstSubmitAttemptFinished || state.hostSubmitClicked;
}

/** Claimed submit jobs that must not run (already submitted, extra auto attempt, or post-deadline too early). */
export function shouldSkipClaimedSubmitJob(input: {
  state: HostSubmitAttemptState;
  postDeadline: boolean;
  manual: boolean;
}): boolean {
  if (input.state.hostSubmitSucceeded || input.state.applicationSubmitted) return true;
  if (input.manual) return false;
  if (input.postDeadline) return !shouldQueuePostDeadlineRetry(input.state);
  if (input.state.waitingNeedsYou) return true;
  return input.state.hostSubmitClicked || input.state.firstSubmitAttemptFinished;
}

/**
 * Auto-submit siblings die after a Submit click so we never double-send.
 * Manual Resubmit must still run — the first click often never recorded a response.
 */
export function shouldCancelAfterSiblingSubmitClick(input: {
  manual: boolean;
  siblingClickedSubmit: boolean;
}): boolean {
  if (input.manual) return false;
  return input.siblingClickedSubmit;
}
