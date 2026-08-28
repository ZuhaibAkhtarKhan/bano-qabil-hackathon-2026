import { fieldSignals, type DetectedField, type FieldType } from "./types";
import { humanQuestionLabel, isNoiseFormField, stripFormSyntaxDecorators } from "./question-label";

export const APPLY_FIELD_ATTR = "data-1apply-key";
export const APPLY_EMPTY_ATTR = "data-1apply-empty";
export const APPLY_HOST_ATTR = "data-1apply-host-card";

const TEXTUAL = new Set(["text", "email", "tel", "search", "password", ""]);

function attr(el: Element, name: string): string {
  return (el.getAttribute(name) ?? "").trim();
}

function normalizeType(tag: string, inputType: string, multiple: boolean): FieldType {
  const type = inputType.toLowerCase();
  if (tag === "textarea") return "textarea";
  if (tag === "select") return multiple ? "multi-select" : "select";
  if (type === "radio") return "radio";
  if (type === "checkbox") return "checkbox";
  if (type === "date" || type === "datetime-local" || type === "month") return "date";
  if (type === "number" || type === "range") return "number";
  if (type === "url") return "url";
  if (type === "file") return "file";
  if (type === "email" || type === "tel" || TEXTUAL.has(type)) return "text";
  return "text";
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function stamp(el: Element | null | undefined, key: string) {
  if (!el) return;
  el.setAttribute(APPLY_FIELD_ATTR, key);
}

function stampCard(item: Element | null | undefined, key: string) {
  if (!item) return;
  item.setAttribute(APPLY_FIELD_ATTR, key);
  item.setAttribute(APPLY_HOST_ATTR, "1");
}

/** Google Forms / ATS often put the red * / "Required" / "Obligatoriskt" beside the heading. */
export function isMarkedRequired(item: Element, heading: Element | null | undefined, label: string, control?: Element | null): boolean {
  if (/required|obligatorisk|mandatory|pflichtfeld|erforderlich|\*/i.test(label)) return true;
  if (heading && /required|obligatorisk|mandatory|pflichtfeld|erforderlich|\*/i.test(heading.textContent ?? "")) {
    return true;
  }
  if (control && (attr(control, "aria-required") === "true" || (control as HTMLInputElement).required)) return true;

  const header = heading?.parentElement ?? item;
  if (header.querySelector?.('[aria-label*="Required" i], [aria-label*="required" i], [aria-label*="Obligatorisk" i]')) return true;
  const headerText = (header.textContent ?? "").slice(0, 160);
  if (/\*/.test(headerText) || /\b(?:required|obligatorisk|mandatory)\b/i.test(headerText)) return true;

  const blob = `${label} ${item.textContent ?? ""} ${attr(control ?? item, "aria-label")}`;
  if (/record\s+.+\s+as the email to be included with my response/i.test(blob)) return true;
  return false;
}

function cleanQuestionText(value: string | null | undefined): string {
  return stripFormSyntaxDecorators((value ?? "").replace(/\s+/g, " ").trim()).slice(0, 200);
}

function looksLikeQuestionText(value: string): boolean {
  if (!value || value.length < 2) return false;
  if (/^[a-f0-9_-]{16,}$/i.test(value)) return false;
  if (/^(entry\.\d+|wf-\d+)/i.test(value)) return false;
  return true;
}

function labelFor(el: Element, root: ParentNode): string {
  const id = attr(el, "id");
  if (id && "querySelector" in root) {
    const labelled = (root as Document | Element).querySelector(`label[for="${cssEscape(id)}"]`);
    const text = cleanQuestionText(labelled?.textContent);
    if (looksLikeQuestionText(text)) return text;
  }
  const wrapped = el.closest("label");
  if (wrapped?.textContent) {
    const clone = wrapped.cloneNode(true) as HTMLElement;
    for (const control of Array.from(clone.querySelectorAll("input, textarea, select, button"))) control.remove();
    const text = cleanQuestionText(clone.textContent);
    if (looksLikeQuestionText(text)) return text;
  }

  const labelledBy = attr(el, "aria-labelledby");
  if (labelledBy && "getElementById" in root) {
    const parts = labelledBy
      .split(/\s+/)
      .map((token) => cleanQuestionText((root as Document).getElementById?.(token)?.textContent))
      .filter((text) => looksLikeQuestionText(text));
    if (parts.length) return parts.join(" ").slice(0, 200);
  }

  const item = el.closest('[role="listitem"]');
  const heading = item?.querySelector('[role="heading"]');
  const headingText = cleanQuestionText(heading?.textContent);
  if (looksLikeQuestionText(headingText)) return headingText;

  const aria = cleanQuestionText(attr(el, "aria-label"));
  if (looksLikeQuestionText(aria)) return aria;

  // Common ATS / custom form wrappers: question lives in a sibling or parent title node.
  // Only search tight wrappers — never the whole <form>/body (that returns unrelated labels).
  const host = el.closest(
    "[data-question], [data-field-label], .form-group, .form-field, .field, .question, .application-question, .freebirdFormviewerComponentsQuestionBaseRoot, fieldset, [role='group']",
  );
  if (host && !["form", "body", "html", "main", "section"].includes(host.tagName.toLowerCase())) {
    for (const selector of [
      "[data-question]",
      "[data-field-label]",
      ".question-title",
      ".form-label",
      ".field-label",
      "label",
      "legend",
      "h1",
      "h2",
      "h3",
      "h4",
      '[role="heading"]',
      "p",
      "span",
    ]) {
      const node = host.querySelector(selector);
      if (!node || node === el || el.contains(node)) continue;
      const text = cleanQuestionText(
        node.getAttribute?.("data-question") || node.getAttribute?.("data-field-label") || node.textContent,
      );
      if (looksLikeQuestionText(text) && text.length >= 3 && text.length <= 200) return text;
    }
  }

  // Preceding sibling question text (e.g. <label>Question</label><input> or <p>Question?</p><input>).
  let sibling = el.previousElementSibling;
  for (let i = 0; i < 4 && sibling; i += 1) {
    if (!isLocalQuestionNode(sibling)) {
      sibling = sibling.previousElementSibling;
      continue;
    }
    const text = cleanQuestionText(
      sibling.getAttribute?.("data-question") || sibling.getAttribute?.("aria-label") || sibling.textContent,
    );
    if (looksLikeQuestionText(text) && text.length >= 2 && text.length <= 200) return text;
    sibling = sibling.previousElementSibling;
  }

  return "";
}

function nearbyText(el: Element): string {
  const bits: string[] = [];
  const item = el.closest('[role="listitem"]');
  if (item) {
    const heading = item.querySelector('[role="heading"]');
    if (heading?.textContent) bits.push(cleanQuestionText(heading.textContent));
    const describedBy = attr(el, "aria-describedby");
    if (describedBy && el.ownerDocument) {
      for (const token of describedBy.split(/\s+/)) {
        const node = el.ownerDocument.getElementById(token);
        if (node?.textContent) bits.push(cleanQuestionText(node.textContent).slice(0, 80));
      }
    }
    const description = item.querySelector('[role="text"], .freebirdFormviewerComponentsQuestionBaseDescription');
    if (description?.textContent) bits.push(cleanQuestionText(description.textContent).slice(0, 160));
    return bits.filter(Boolean).join(" ").slice(0, 240);
  }

  const prev = el.previousElementSibling;
  if (prev && isLocalQuestionNode(prev)) {
    bits.push(cleanQuestionText(prev.textContent));
  }
  const parent = el.parentElement;
  if (parent && isTightQuestionHost(parent)) {
    const dt = parent.previousElementSibling;
    if (dt && dt.tagName.toLowerCase() === "dt") bits.push(cleanQuestionText(dt.textContent));
    const title = parent.querySelector("label, legend, [role='heading'], .question-title, .field-label");
    if (title && !el.contains(title) && title !== el) bits.push(cleanQuestionText(title.textContent));
  }
  const group = el.closest("fieldset, [role='group'], .form-group, .field, .question");
  if (group && isTightQuestionHost(group)) {
    const legend = group.querySelector("legend, [role='heading'], label, .question-title");
    if (legend && !el.contains(legend)) bits.push(cleanQuestionText(legend.textContent));
  }
  return bits.filter(Boolean).join(" ").slice(0, 240);
}

function isTightQuestionHost(el: Element): boolean {
  return !["form", "body", "html", "main", "section", "article", "div"].includes(el.tagName.toLowerCase()) ||
    /form-group|form-field|field|question|application-question|listitem/i.test(
      `${el.className} ${el.getAttribute("role") ?? ""} ${el.getAttribute("data-question") ?? ""}`,
    );
}

/** Preceding nodes that are question copy, not another whole question card. */
function isLocalQuestionNode(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (["label", "legend", "p", "span", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "em"].includes(tag)) {
    return true;
  }
  if (["input", "textarea", "select", "button", "form"].includes(tag)) return false;
  // Reject wrappers that contain other controls — those belong to a different question.
  if (el.querySelector("input, textarea, select, button, [role='listbox'], [role='textbox']")) return false;
  const text = cleanQuestionText(el.textContent);
  return looksLikeQuestionText(text) && text.length <= 200;
}

function optionLabel(el: Element): string {
  const aria = attr(el, "aria-label");
  if (aria) return aria;
  const dataValue = attr(el, "data-value");
  if (dataValue) return dataValue;
  const labelledBy = attr(el, "aria-labelledby");
  if (labelledBy && el.ownerDocument) {
    const text = labelledBy
      .split(/\s+/)
      .map((token) => el.ownerDocument?.getElementById(token)?.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }
  const wrap = el.closest("label");
  if (wrap) {
    const clone = wrap.cloneNode(true) as HTMLElement;
    for (const control of Array.from(clone.querySelectorAll("input, textarea, select"))) control.remove();
    const text = clone.textContent?.trim() ?? "";
    if (text) return text;
  }
  const span = el.querySelector("span, .docssharedWizToggleLabeledLabelText");
  if (span?.textContent?.trim()) return span.textContent.trim().slice(0, 160);
  return ((el as HTMLInputElement).value || el.textContent || "").trim().slice(0, 160);
}

function selectOptions(el: Element): string[] {
  if (el.tagName.toLowerCase() !== "select") return [];
  return Array.from(el.querySelectorAll("option"))
    .map((option) => (option.textContent ?? "").trim())
    .filter(Boolean);
}

function choiceOptions(el: Element, inputType: string, root: ParentNode): string[] {
  if (el.tagName.toLowerCase() === "select") return selectOptions(el);
  if (inputType !== "radio" && inputType !== "checkbox") return [];

  const item = el.closest('[role="listitem"]');
  if (item) {
    const roleRadios = Array.from(item.querySelectorAll('[role="radio"], [role="checkbox"]'));
    if (roleRadios.length) return roleRadios.map((node) => optionLabel(node)).filter(Boolean);
    return Array.from(item.querySelectorAll(`input[type="${inputType}"]`))
      .map((node) => optionLabel(node))
      .filter(Boolean);
  }

  const name = attr(el, "name");
  if (name && "querySelectorAll" in root) {
    return Array.from((root as Document | Element).querySelectorAll(`input[type="${inputType}"][name="${cssEscape(name)}"]`))
      .map((node) => optionLabel(node))
      .filter(Boolean);
  }

  return [optionLabel(el)].filter(Boolean);
}

function listitemKey(item: Element, index: number): string {
  const heading = item.querySelector('[role="heading"]');
  const headingId = heading?.id || attr(heading ?? item, "id");
  if (headingId) return `listitem:${headingId}`;
  const labelledBy = attr(item.querySelector("[aria-labelledby]") ?? item, "aria-labelledby");
  if (labelledBy) return `listitem:${labelledBy}`;
  return `listitem:pos:${index}`;
}

function existingListitemKey(el: Element, root: ParentNode): string | null {
  const item = el.closest('[role="listitem"]');
  if (!item) return null;
  const items = Array.from((root as Document | Element).querySelectorAll?.('[role="listitem"]') ?? []);
  const index = items.indexOf(item);
  return listitemKey(item, index >= 0 ? index : 0);
}

function pushField(fields: DetectedField[], field: Omit<DetectedField, "signals">) {
  const next: DetectedField = { ...field, signals: "" };
  next.label = humanQuestionLabel(next);
  next.signals = fieldSignals(next);
  if (isNoiseFormField(next)) return;
  fields.push(next);
}

function inventoryGoogleFormsListitems(root: ParentNode, seen: Set<string>): DetectedField[] {
  const fields: DetectedField[] = [];
  const items = Array.from((root as Document | Element).querySelectorAll?.('[role="listitem"]') ?? []);

  for (const [index, item] of items.entries()) {
    const key = listitemKey(item, index);
    if (seen.has(key)) continue;

    const heading = item.querySelector('[role="heading"]');
    const label = cleanQuestionText(heading?.textContent) || labelFor(item, root);
    const textBlob = `${label} ${item.textContent ?? ""}`.toLowerCase();

    const listbox = item.querySelector('[role="listbox"]');
    if (listbox) {
      seen.add(key);
      const options = Array.from(item.querySelectorAll('[role="option"]'))
        .map((node) => optionLabel(node))
        .filter(Boolean);
      // Options often only exist after open; still register the control.
      stamp(listbox, key);
      stampCard(item, key);
      pushField(fields, {
        key,
        name: "",
        id: heading?.id ?? "",
        label,
        placeholder: "Choose",
        ariaLabel: attr(listbox, "aria-label"),
        nearbyText: label,
        type: "select",
        inputType: "listbox",
        options,
        required: isMarkedRequired(item, heading, label, listbox),
        autocomplete: "",
      });
      continue;
    }

    const roleRadios = Array.from(item.querySelectorAll('[role="radio"]'));
    if (roleRadios.length > 0) {
      seen.add(key);
      const options = roleRadios.map((node) => optionLabel(node)).filter(Boolean);
      for (const radio of roleRadios) stamp(radio, key);
      stampCard(item, key);
      pushField(fields, {
        key,
        name: "",
        id: heading?.id ?? "",
        label,
        placeholder: "",
        ariaLabel: "",
        nearbyText: label,
        type: "radio",
        inputType: "radio",
        options,
        required: isMarkedRequired(item, heading, label),
        autocomplete: "",
      });
      continue;
    }

    const roleChecks = Array.from(item.querySelectorAll('[role="checkbox"]'));
    if (roleChecks.length > 1 || (roleChecks.length === 1 && /select all|choose all|which of the following/i.test(textBlob))) {
      seen.add(key);
      const options = roleChecks.map((node) => optionLabel(node)).filter(Boolean);
      for (const box of roleChecks) stamp(box, key);
      stampCard(item, key);
      pushField(fields, {
        key,
        name: "",
        id: heading?.id ?? "",
        label,
        placeholder: "",
        ariaLabel: "",
        nearbyText: label,
        type: "checkbox",
        inputType: "checkbox",
        options,
        required: isMarkedRequired(item, heading, label),
        autocomplete: "",
      });
      continue;
    }

    if (roleChecks.length === 1) {
      seen.add(key);
      const only = roleChecks[0]!;
      const option = optionLabel(only) || label || "Confirm";
      stamp(only, key);
      stampCard(item, key);
      pushField(fields, {
        key,
        name: "",
        id: heading?.id ?? "",
        label: label || option,
        placeholder: "",
        ariaLabel: attr(only, "aria-label"),
        nearbyText: `${label} ${option}`.trim(),
        type: "checkbox",
        inputType: "checkbox",
        options: [option],
        required: isMarkedRequired(item, heading, label, only),
        autocomplete: "",
      });
      continue;
    }

    const nativeChecks = Array.from(item.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    if (nativeChecks.length === 1 && !item.querySelector("input:not([type=checkbox]):not([type=hidden])")) {
      seen.add(key);
      const only = nativeChecks[0]!;
      const option = optionLabel(only) || label || "Confirm";
      stamp(only, key);
      stampCard(item, key);
      pushField(fields, {
        key,
        name: only.name || "",
        id: only.id || heading?.id || "",
        label: label || option,
        placeholder: "",
        ariaLabel: attr(only, "aria-label"),
        nearbyText: `${label} ${option}`.trim(),
        type: "checkbox",
        inputType: "checkbox",
        options: [option],
        required: isMarkedRequired(item, heading, label, only),
        autocomplete: "",
      });
      continue;
    }

    const addFile =
      Array.from(item.querySelectorAll('[role="button"], button')).find((node) =>
        /add file|upload file|browse/i.test(`${attr(node, "aria-label")} ${node.textContent ?? ""}`),
      ) || (/cv or resume|upload.*(pdf|file)|attach.*(resume|cv|file)/i.test(textBlob) ? item : null);

    const fileInput = item.querySelector('input[type="file"]');
    if (addFile || fileInput || /cv or resume|resume \(pdf\)|upload.*(resume|cv|pdf)/i.test(textBlob)) {
      seen.add(key);
      if (fileInput) stamp(fileInput, key);
      if (addFile && addFile !== item) stamp(addFile, key);
      stampCard(item, key);
      pushField(fields, {
        key,
        name: "",
        id: heading?.id ?? "",
        label,
        placeholder: "",
        ariaLabel: "",
        nearbyText: label,
        type: "file",
        inputType: "file",
        options: [],
        required: isMarkedRequired(item, heading, label),
        autocomplete: "",
      });
      continue;
    }

    // Short / paragraph answers (Google Forms text / textarea / role=textbox).
    const textControl =
      item.querySelector<HTMLElement>('textarea, input[type="text"], input:not([type]), [role="textbox"], [contenteditable="true"]') ||
      null;
    if (textControl && label.trim()) {
      seen.add(key);
      const tag = textControl.tagName.toLowerCase();
      const isArea =
        tag === "textarea" ||
        textControl.getAttribute("role") === "textbox" ||
        textControl.getAttribute("contenteditable") === "true" ||
        (textControl.textContent ?? "").length > 0 && tag === "div";
      stamp(textControl, key);
      // Also stamp a nested native input if the stamped node is a wrapper.
      const nested = textControl.querySelector?.("input, textarea");
      if (nested) stamp(nested, key);
      stampCard(item, key);
      pushField(fields, {
        key,
        name: attr(textControl, "name") || (textControl as HTMLInputElement).name || "",
        id: heading?.id ?? attr(textControl, "id"),
        label,
        placeholder: attr(textControl, "placeholder") || "Your answer",
        ariaLabel: attr(textControl, "aria-label"),
        nearbyText: `${label} ${(item.textContent ?? "").slice(0, 280)}`.trim(),
        type: isArea ? "textarea" : "text",
        inputType: isArea ? "textarea" : "text",
        options: [],
        required: isMarkedRequired(item, heading, label, textControl),
        autocomplete: attr(textControl, "autocomplete"),
      });
    }
  }

  return fields;
}

function fieldKey(el: Element, index: number, name: string, id: string): string {
  if (name) return name;
  if (id) return id;
  const item = el.closest('[role="listitem"]');
  const heading = item?.querySelector('[role="heading"]');
  const headingId = heading?.id || attr(heading ?? el, "id");
  if (item && headingId) return `listitem:${headingId}`;
  const labelledBy = attr(el, "aria-labelledby");
  if (labelledBy) return `labelledby:${labelledBy}`;
  const ariaLabel = attr(el, "aria-label");
  if (ariaLabel) return `aria:${ariaLabel.slice(0, 48)}`;
  return `pos:${index}`;
}

export function inventoryFromDocument(root: ParentNode): DetectedField[] {
  const fields: DetectedField[] = [];
  const seen = new Set<string>();

  // Google Forms custom widgets first (listbox / role=radio / Add file).
  for (const field of inventoryGoogleFormsListitems(root, seen)) {
    fields.push(field);
  }

  const nodes = Array.from(root.querySelectorAll("input, textarea, select"));
  for (const [index, el] of nodes.entries()) {
    const tag = el.tagName.toLowerCase();
    const inputType = (attr(el, "type") || (el as HTMLInputElement).type || "").toLowerCase();
    if (inputType === "hidden" || inputType === "submit" || inputType === "button" || inputType === "image" || inputType === "reset") {
      continue;
    }

    // Already inventoried via Google Forms listitem — keep stamps on the listitem key.
    const listKey = existingListitemKey(el, root);
    if (listKey && seen.has(listKey)) {
      stamp(el, listKey);
      continue;
    }

    const name = attr(el, "name") || (el as HTMLInputElement).name || "";
    const id = attr(el, "id") || el.id || "";
    const key = fieldKey(el, index, name, id);

    if (seen.has(key) && inputType !== "radio") {
      // Already captured as a Google Forms widget — still stamp native control.
      stamp(el, key);
      continue;
    }

    if (inputType === "radio") {
      const groupKey = name ? `radio:${name}` : key.startsWith("listitem:") ? `radio:${key}` : "";
      if (groupKey && seen.has(groupKey)) {
        stamp(el, key);
        continue;
      }
      if (groupKey) seen.add(groupKey);
    }

    if (seen.has(key) && inputType !== "radio") continue;
    seen.add(key);

    const label = labelFor(el, root);
    const placeholder = attr(el, "placeholder");
    const ariaLabel = attr(el, "aria-label");
    const nearby = nearbyText(el);
    const multiple = el.hasAttribute("multiple");
    const type = normalizeType(tag, inputType, multiple);
    const options = choiceOptions(el, inputType, root);
    const draft: DetectedField = {
      key,
      name,
      id,
      label,
      placeholder,
      ariaLabel,
      nearbyText: nearby,
      type,
      inputType,
      options,
      required:
        el.hasAttribute("required") ||
        attr(el, "aria-required") === "true" ||
        /required|\*/i.test(label) ||
        (el.closest('[role="listitem"]')
          ? isMarkedRequired(el.closest('[role="listitem"]')!, el.closest('[role="listitem"]')?.querySelector('[role="heading"]') ?? null, label, el)
          : false),
      autocomplete: attr(el, "autocomplete"),
      signals: "",
    };
    draft.label = humanQuestionLabel(draft);
    draft.signals = fieldSignals(draft);
    if (isNoiseFormField(draft)) continue;

    stamp(el, key);
    stampCard(el.closest('[role="listitem"]'), key);
    if ((inputType === "radio" || inputType === "checkbox") && key.startsWith("listitem:")) {
      const item = el.closest('[role="listitem"]');
      for (const sibling of Array.from(item?.querySelectorAll(`input[type="${inputType}"]`) ?? [])) {
        stamp(sibling, key);
      }
    }
    fields.push(draft);
  }

  return fields;
}
