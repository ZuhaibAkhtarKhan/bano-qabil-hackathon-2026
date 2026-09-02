"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition, type FormEvent } from "react";

import { useNeedsYouQueue } from "@/components/app/needs-you-queue-provider";
import { ERRORS, FLASH, type ErrorCode, type FlashCode } from "@/server/http/flash";
import type { NeedsYouActionResult } from "@/server/needs-you/actions";
import { Notice } from "@/components/ui/feedback";

function messageForResult(result: NeedsYouActionResult): string | null {
  if (result.ok) {
    return result.notice && result.notice in FLASH ? FLASH[result.notice as FlashCode] : "Saved.";
  }
  return result.error in ERRORS ? ERRORS[result.error as ErrorCode] : ERRORS.save;
}

export function useNeedsYouSave(options: {
  itemId: string;
  applicationId?: string;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const { onItemResolved, onApplicationRemoved, refreshQueue } = useNeedsYouQueue();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ tone: "mint" | "coral"; message: string } | null>(null);

  const submit = useCallback(
    (
      buildFormData: () => FormData,
      action: (formData: FormData) => Promise<NeedsYouActionResult>,
      mode: "item" | "application" = "item",
    ) => {
      setFeedback(null);
      startTransition(async () => {
        const result = await action(buildFormData());
        if (!result.ok) {
          setFeedback({ tone: "coral", message: messageForResult(result) ?? ERRORS.save });
          return;
        }

        if (mode === "application" && options.applicationId) {
          onApplicationRemoved(options.applicationId);
        } else {
          onItemResolved(options.itemId);
        }

        setFeedback({ tone: "mint", message: messageForResult(result) ?? "Saved." });
        options.onSuccess?.();
        router.refresh();
        void refreshQueue();
      });
    },
    [onApplicationRemoved, onItemResolved, options, refreshQueue, router],
  );

  const handleSubmit = useCallback(
    (
      event: FormEvent<HTMLFormElement>,
      action: (formData: FormData) => Promise<NeedsYouActionResult>,
      mode: "item" | "application" = "item",
    ) => {
      event.preventDefault();
      const form = event.currentTarget;
      submit(() => new FormData(form), action, mode);
    },
    [submit],
  );

  const feedbackNotice = feedback ? (
    <Notice tone={feedback.tone === "coral" ? "coral" : "mint"}>{feedback.message}</Notice>
  ) : null;

  return { isPending, feedbackNotice, submit, handleSubmit };
}
