import {
  assertFillActionAllowed,
  inspectPage,
  inventoryFromDocument,
} from "@1apply/form-engine";

type FillPayload = { fieldKey: string; value: string; type: string };

const root = globalThis as { __1APPLY_LISTENERS?: boolean };
if (!root.__1APPLY_LISTENERS) {
  root.__1APPLY_LISTENERS = true;

  function applyValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, mapping: FillPayload): boolean {
    if (mapping.type === "checkbox") {
      (el as HTMLInputElement).checked = mapping.value === "true" || mapping.value === el.getAttribute("value");
    } else if (mapping.type === "radio") {
      const group = Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${el.getAttribute("name")}"]`));
      for (const node of group) {
        node.checked = node.value === mapping.value || node.id === mapping.fieldKey;
        node.dispatchEvent(new Event("input", { bubbles: true }));
        node.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return true;
    } else {
      el.value = mapping.value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function cssEscape(value: string): string {
    if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
    return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function findControl(fieldKey: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
    return (
      document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${cssEscape(fieldKey)}"]`) ||
      document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#${cssEscape(fieldKey)}`)
    );
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "GET_PAGE_META") {
      sendResponse({
        type: "PAGE_META_RESULT",
        url: location.href,
        title: document.title,
        excerpt: document.body?.innerText?.slice(0, 4000) ?? "",
      });
      return false;
    }

    if (message?.type === "INVENTORY") {
      const fields = inventoryFromDocument(document);
      const hazards = inspectPage(document, document.body?.innerText ?? "", fields);
      sendResponse({
        type: "INVENTORY_RESULT",
        fields,
        hazards,
        html: document.documentElement.outerHTML.slice(0, 20_000),
        url: location.href,
        title: document.title,
      });
      return false;
    }

    if (message?.type === "FILL") {
      assertFillActionAllowed("setValue");
      const results: Array<{ fieldKey: string; filled: boolean; skippedReason?: string }> = [];
      for (const mapping of (message.mappings ?? []) as FillPayload[]) {
        if (!mapping.value) {
          results.push({ fieldKey: mapping.fieldKey, filled: false, skippedReason: "Empty value" });
          continue;
        }
        const el = findControl(mapping.fieldKey);
        if (!el) {
          results.push({ fieldKey: mapping.fieldKey, filled: false, skippedReason: "Control not found" });
          continue;
        }
        applyValue(el, mapping);
        results.push({ fieldKey: mapping.fieldKey, filled: true });
      }
      sendResponse({ type: "FILL_RESULT", filled: results });
      return false;
    }

    return false;
  });
}
