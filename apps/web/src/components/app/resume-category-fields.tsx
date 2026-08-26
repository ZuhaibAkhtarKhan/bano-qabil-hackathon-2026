"use client";

import { useState } from "react";
import { RESUME_CATEGORY_PRESETS } from "@1apply/domain";

import { Field, Input, Select } from "@/components/ui/field";
import { cn } from "@/lib/cn";

/**
 * Category is for user remembrance only. Version is assigned by upload time on the server.
 */
export function ResumeCategoryFields({
  idPrefix,
  className,
  defaultPreset = "general",
}: {
  idPrefix: string;
  className?: string;
  defaultPreset?: string;
}) {
  const [preset, setPreset] = useState(defaultPreset);

  return (
    <div className={cn("grid gap-3", className)}>
      <Field
        label="Resume category"
        htmlFor={`${idPrefix}-category`}
        hint="For your own organization only. Job matching scores every resume with AI — category is never used as a filter."
      >
        <Select
          id={`${idPrefix}-category`}
          name="resumeCategory"
          value={preset}
          onChange={(event) => setPreset(event.target.value)}
          required
        >
          {RESUME_CATEGORY_PRESETS.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
          <option value="other">Others</option>
        </Select>
      </Field>
      {preset === "other" ? (
        <Field label="Custom category name" htmlFor={`${idPrefix}-category-other`}>
          <Input
            id={`${idPrefix}-category-other`}
            name="resumeCategoryOther"
            required
            placeholder="e.g. Data science, Product design"
            maxLength={80}
          />
        </Field>
      ) : (
        <input type="hidden" name="resumeCategoryOther" value="" />
      )}
      <p className="text-xs text-ink-muted">
        Uploading again to the same category creates the next version automatically (v1, v2, …) by time. You do not pick
        the version.
      </p>
    </div>
  );
}
