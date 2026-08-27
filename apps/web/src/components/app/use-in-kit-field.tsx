"use client";

export function UseInKitField({
  defaultChecked = true,
  compact = false,
}: {
  defaultChecked?: boolean;
  compact?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input
        type="checkbox"
        name="useInKit"
        value="on"
        defaultChecked={defaultChecked}
        className="mt-0.5 h-4 w-4 rounded border-line"
      />
      <span>
        <span className="font-medium text-ink">Update Your kit from this document</span>
        {!compact ? (
          <span className="mt-0.5 block text-xs text-ink-muted">
            When checked, extracted text fills blank kit fields with AI. Uncheck to store the file for applications
            only.
          </span>
        ) : null}
      </span>
    </label>
  );
}
