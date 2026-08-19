import { fieldSignals, type DetectedField, type FieldType } from "./types";

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

function labelFor(el: Element, root: ParentNode): string {
  const id = attr(el, "id");
  if (id && "querySelector" in root) {
    const labelled = (root as Document | Element).querySelector(`label[for="${cssEscape(id)}"]`);
    if (labelled?.textContent) return labelled.textContent.trim();
  }
  const wrapped = el.closest("label");
  if (wrapped?.textContent) return wrapped.textContent.trim();
  const labelledBy = attr(el, "aria-labelledby");
  if (labelledBy && "getElementById" in root) {
    const parts = labelledBy
      .split(/\s+/)
      .map((token) => (root as Document).getElementById?.(token)?.textContent?.trim() ?? "")
      .filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  return "";
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function nearbyText(el: Element): string {
  const bits: string[] = [];
  const prev = el.previousElementSibling;
  if (prev && !["input", "textarea", "select", "button"].includes(prev.tagName.toLowerCase())) {
    bits.push(prev.textContent?.trim() ?? "");
  }
  const parent = el.parentElement;
  if (parent) {
    const dt = parent.previousElementSibling;
    if (dt && dt.tagName.toLowerCase() === "dt") bits.push(dt.textContent?.trim() ?? "");
    const heading = parent.querySelector("legend, h1, h2, h3, h4, span, p");
    if (heading && heading !== el) bits.push((heading.textContent ?? "").trim().slice(0, 120));
  }
  const group = el.closest("fieldset, [role='group'], .form-group, .field");
  const legend = group?.querySelector("legend");
  if (legend) bits.push(legend.textContent?.trim() ?? "");
  return bits.filter(Boolean).join(" ").slice(0, 240);
}

function optionsOf(el: Element): string[] {
  if (el.tagName.toLowerCase() !== "select") return [];
  return Array.from(el.querySelectorAll("option")).map((option) => (option.textContent ?? "").trim()).filter(Boolean);
}

export function inventoryFromDocument(root: ParentNode): DetectedField[] {
  const nodes = Array.from(root.querySelectorAll("input, textarea, select"));
  const fields: DetectedField[] = [];
  const seen = new Set<string>();

  for (const [index, el] of nodes.entries()) {
    const tag = el.tagName.toLowerCase();
    const inputType = (attr(el, "type") || (el as HTMLInputElement).type || "").toLowerCase();
    if (inputType === "hidden" || inputType === "submit" || inputType === "button" || inputType === "image" || inputType === "reset") {
      continue;
    }
    const name = attr(el, "name") || (el as HTMLInputElement).name || "";
    const id = attr(el, "id") || el.id || "";
    const key = name || id || `${tag}-${index}`;
    if (inputType === "radio" && seen.has(`radio:${name}`)) continue;
    if (inputType === "radio") seen.add(`radio:${name}`);

    const label = labelFor(el, root);
    const placeholder = attr(el, "placeholder");
    const ariaLabel = attr(el, "aria-label");
    const nearby = nearbyText(el);
    const multiple = el.hasAttribute("multiple");
    const type = normalizeType(tag, inputType, multiple);
    const field: DetectedField = {
      key,
      name,
      id,
      label,
      placeholder,
      ariaLabel,
      nearbyText: nearby,
      type,
      inputType,
      options: optionsOf(el),
      required: el.hasAttribute("required") || attr(el, "aria-required") === "true",
      autocomplete: attr(el, "autocomplete"),
      signals: "",
    };
    field.signals = fieldSignals(field);
    fields.push(field);
  }

  return fields;
}
