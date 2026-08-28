"use client";

import { useEffect, useRef } from "react";

import { useEphemeralToast } from "@/components/ui/ephemeral-toast";
import { uploadNoticeMessage } from "@/lib/upload-notices";

export function UploadNoticeToast({ notice }: { notice?: string }) {
  const { showToast } = useEphemeralToast();
  const shownRef = useRef<string | null>(null);

  useEffect(() => {
    const message = uploadNoticeMessage(notice);
    if (!message) return;
    if (shownRef.current === notice) return;
    shownRef.current = notice ?? null;
    showToast(message, 3200);
  }, [notice, showToast]);

  return null;
}
