/**
 * Playwright-shaped page/locator helpers on top of Puppeteer so the host
 * fill/submit pipeline can stay the same.
 */
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Browser, ElementHandle, Frame as PuppeteerFrame, Page as PuppeteerPage } from "puppeteer";

export type HostFilePayload = { name: string; mimeType: string; buffer: Buffer };

type QueryRoot = PuppeteerPage | PuppeteerFrame | ElementHandle<Element>;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function textMatches(value: string, pattern: string | RegExp): boolean {
  const text = value.replace(/\s+/g, " ").trim();
  if (pattern instanceof RegExp) return pattern.test(text);
  return text.toLowerCase().includes(pattern.trim().toLowerCase());
}

function selectorForRole(role: string): string {
  if (role === "button") {
    return 'button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"]';
  }
  if (role === "checkbox") return 'input[type="checkbox"], [role="checkbox"]';
  if (role === "radio") return 'input[type="radio"], [role="radio"]';
  if (role === "option") return '[role="option"]';
  if (role === "listbox") return '[role="listbox"]';
  if (role === "tab") return '[role="tab"]';
  if (role === "heading") return 'h1, h2, h3, h4, h5, h6, [role="heading"]';
  if (role === "link") return 'a[href], [role="link"]';
  if (role === "textbox") {
    return 'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea, [role="textbox"]';
  }
  return `[role="${role}"]`;
}

function toPuppeteerSelector(selector: string): string {
  if (!selector.startsWith("xpath=")) return selector;
  const xpath = selector.slice("xpath=".length);
  const relativeAxis =
    /^(ancestor|ancestor-or-self|parent|following|following-sibling|preceding|preceding-sibling|self)\b/.test(xpath);
  const path =
    xpath.startsWith("/") || xpath.startsWith(".")
      ? xpath
      : relativeAxis
        ? `./${xpath}`
        : `.//${xpath}`;
  return `xpath/${path}`;
}

async function queryAll(root: QueryRoot, selector: string): Promise<Array<ElementHandle<Element>>> {
  return (await root.$$(toPuppeteerSelector(selector))) as Array<ElementHandle<Element>>;
}

async function isHandleVisible(handle: ElementHandle<Element>): Promise<boolean> {
  return handle.evaluate((el) => {
    const node = el as HTMLElement;
    if (!node.getBoundingClientRect) return false;
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 2 && rect.height > 2;
  });
}

async function accessibleName(handle: ElementHandle<Element>): Promise<string> {
  return handle.evaluate((el) => {
    const node = el as HTMLElement;
    const labelledBy = node.getAttribute("aria-labelledby");
    let labelled = "";
    if (labelledBy) {
      labelled = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
    }
    const own =
      node.getAttribute("aria-label") ||
      (node as HTMLInputElement).labels?.[0]?.textContent ||
      node.getAttribute("placeholder") ||
      node.textContent ||
      "";
    return `${labelled} ${own}`.replace(/\s+/g, " ").trim();
  });
}

async function writeTempUpload(file: HostFilePayload): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "1apply-upload-"));
  const path = join(dir, file.name.replace(/[^\w.\-]+/g, "_") || "upload.bin");
  await writeFile(path, file.buffer);
  return path;
}

export class HostFileChooser {
  constructor(private readonly acceptPaths: (paths: string[]) => Promise<void>) {}

  async setFiles(file: HostFilePayload): Promise<void> {
    const path = await writeTempUpload(file);
    try {
      await this.acceptPaths([path]);
      await delay(150);
    } finally {
      await rm(path, { force: true }).catch(() => undefined);
    }
  }
}

type LocatorOptions = {
  nth?: number;
  first?: boolean;
  hasText?: string | RegExp;
  roleName?: string | RegExp;
  alts?: HostLocator[];
};

export class HostLocator {
  constructor(
    private readonly owner: HostPage,
    private readonly root: QueryRoot,
    private readonly selector: string,
    private readonly options: LocatorOptions = {},
    private readonly parentLocator?: HostLocator,
  ) {}

  page(): HostPage {
    return this.owner;
  }

  locator(selector: string): HostLocator {
    return new HostLocator(this.owner, this.root, selector, {}, this);
  }

  first(): HostLocator {
    return new HostLocator(this.owner, this.root, this.selector, { ...this.options, first: true, nth: 0 }, this.parentLocator);
  }

  nth(index: number): HostLocator {
    return new HostLocator(this.owner, this.root, this.selector, { ...this.options, first: false, nth: index }, this.parentLocator);
  }

  filter(input: { hasText: string | RegExp }): HostLocator {
    return new HostLocator(this.owner, this.root, this.selector, { ...this.options, hasText: input.hasText }, this.parentLocator);
  }

  or(other: HostLocator): HostLocator {
    return new HostLocator(this.owner, this.root, this.selector, {
      ...this.options,
      alts: [...(this.options.alts ?? []), other],
    }, this.parentLocator);
  }

  getByRole(role: string, opts?: { name?: string | RegExp }): HostLocator {
    return new HostLocator(
      this.owner,
      this.root,
      selectorForRole(role),
      opts?.name ? { roleName: opts.name } : {},
      this,
    );
  }

  getByLabel(pattern: string | RegExp): HostLocator {
    return new HostLocator(
      this.owner,
      this.root,
      'input, textarea, select, [role="textbox"], [role="combobox"], [role="listbox"]',
      { roleName: pattern },
      this,
    );
  }

  private async queryRoot(): Promise<QueryRoot> {
    if (!this.parentLocator) return this.root;
    return (await this.parentLocator.firstHandle()) ?? this.root;
  }

  private async resolveFrom(root: QueryRoot): Promise<Array<ElementHandle<Element>>> {
    let handles = await queryAll(root, this.selector);
    if (this.options.hasText) {
      const matched: Array<ElementHandle<Element>> = [];
      for (const handle of handles) {
        const text = (await handle.evaluate((el) => (el.textContent ?? "").replace(/\s+/g, " "))) ?? "";
        if (textMatches(text, this.options.hasText)) matched.push(handle);
      }
      handles = matched;
    }
    if (this.options.roleName) {
      const matched: Array<ElementHandle<Element>> = [];
      for (const handle of handles) {
        const name = await accessibleName(handle);
        if (textMatches(name, this.options.roleName)) matched.push(handle);
      }
      handles = matched;
    }
    if (this.options.first || this.options.nth === 0) return handles.slice(0, 1);
    if (typeof this.options.nth === "number") {
      return handles[this.options.nth] ? [handles[this.options.nth]!] : [];
    }
    return handles;
  }

  async resolve(): Promise<Array<ElementHandle<Element>>> {
    const own = await this.resolveFrom(await this.queryRoot());
    if (own.length > 0) return own;
    for (const alt of this.options.alts ?? []) {
      const extra = await alt.resolve();
      if (extra.length > 0) return extra;
    }
    return [];
  }

  async count(): Promise<number> {
    return (await this.resolve()).length;
  }

  async firstHandle(): Promise<ElementHandle<Element> | null> {
    return (await this.resolve())[0] ?? null;
  }

  async click(opts?: { timeout?: number; force?: boolean }): Promise<void> {
    const timeout = opts?.timeout ?? 4_000;
    const deadline = Date.now() + timeout;
    let handle = await this.firstHandle();
    while (!handle && Date.now() < deadline) {
      await delay(80);
      handle = await this.firstHandle();
    }
    if (!handle) throw new Error(`No node for ${this.selector}`);
    await handle.evaluate((el) => {
      const node = el as HTMLInputElement | HTMLTextAreaElement;
      if ("disabled" in node) node.disabled = false;
    }).catch(() => undefined);
    if (opts?.force) {
      await handle.evaluate((el) => (el as HTMLElement).click());
      return;
    }
    try {
      await handle.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
      await handle.click({ delay: 10 });
    } catch {
      await handle.evaluate((el) => (el as HTMLElement).click());
    }
  }

  async fill(value: string, _opts?: { timeout?: number; force?: boolean }): Promise<void> {
    const handle = await this.firstHandle();
    if (!handle) throw new Error(`No node to fill for ${this.selector}`);
    await handle.evaluate((el) => {
      const node = el as HTMLInputElement | HTMLTextAreaElement;
      if ("disabled" in node) node.disabled = false;
      if ("readOnly" in node) node.readOnly = false;
    }).catch(() => undefined);
    await handle.click({ clickCount: 3 }).catch(() => undefined);
    const tag = await handle.evaluate((el) => el.tagName.toLowerCase());
    if (tag === "select") {
      await handle.evaluate((el, next) => {
        (el as HTMLSelectElement).value = String(next);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, value);
      return;
    }
    await handle.click().catch(() => undefined);
    const page = this.owner.raw;
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace").catch(() => undefined);
    await page.keyboard.type(value, { delay: 8 });
  }

  async pressSequentially(value: string, opts?: { delay?: number; timeout?: number }): Promise<void> {
    const handle = await this.firstHandle();
    if (!handle) throw new Error(`No node to type for ${this.selector}`);
    await handle.click().catch(() => undefined);
    await this.owner.raw.keyboard.type(value, { delay: opts?.delay ?? 12 });
  }

  async press(key: string): Promise<void> {
    await this.owner.keyboard.press(key);
  }

  async focus(): Promise<void> {
    const handle = await this.firstHandle();
    if (!handle) throw new Error(`No node to focus for ${this.selector}`);
    await handle.evaluate((el) => (el as HTMLElement).focus());
  }

  async scrollIntoViewIfNeeded(): Promise<void> {
    const handle = await this.firstHandle();
    if (!handle) return;
    await handle.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
  }

  async inputValue(): Promise<string> {
    const handle = await this.firstHandle();
    if (!handle) return "";
    return handle.evaluate((el) => {
      const node = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      return "value" in node ? String(node.value ?? "") : "";
    });
  }

  async textContent(): Promise<string | null> {
    const handle = await this.firstHandle();
    if (!handle) return null;
    return handle.evaluate((el) => el.textContent);
  }

  async innerText(): Promise<string> {
    const handle = await this.firstHandle();
    if (!handle) return "";
    return handle.evaluate((el) => (el as HTMLElement).innerText ?? el.textContent ?? "");
  }

  async getAttribute(name: string): Promise<string | null> {
    const handle = await this.firstHandle();
    if (!handle) return null;
    return handle.evaluate((el, key) => el.getAttribute(String(key)), name);
  }

  async isVisible(): Promise<boolean> {
    const handle = await this.firstHandle();
    if (!handle) return false;
    return isHandleVisible(handle);
  }

  async isChecked(_opts?: { timeout?: number }): Promise<boolean> {
    const handle = await this.firstHandle();
    if (!handle) return false;
    return handle.evaluate((el) => {
      const node = el as HTMLInputElement;
      if (typeof node.checked === "boolean") return node.checked;
      return node.getAttribute("aria-checked") === "true" || node.getAttribute("aria-selected") === "true";
    });
  }

  async evaluate<T, Arg = unknown>(fn: (el: Element, arg: Arg) => T, arg?: Arg): Promise<T> {
    const handle = await this.firstHandle();
    if (!handle) throw new Error(`No node to evaluate for ${this.selector}`);
    return handle.evaluate(fn as (el: Element, arg: unknown) => T, arg as unknown);
  }

  async waitFor(opts?: { state?: "visible" | "attached"; timeout?: number }): Promise<void> {
    const timeout = opts?.timeout ?? 5_000;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const handle = await this.firstHandle();
      if (handle && (opts?.state !== "visible" || (await isHandleVisible(handle)))) return;
      await delay(80);
    }
    throw new Error(`Timeout waiting for ${this.selector}`);
  }

  async selectOption(choice: { label?: string; value?: string }, _opts?: { timeout?: number }): Promise<void> {
    const handle = await this.firstHandle();
    if (!handle) throw new Error(`No select for ${this.selector}`);
    const ok = await handle.evaluate((el, picked) => {
      const select = el as HTMLSelectElement;
      const match =
        Array.from(select.options).find(
          (opt) => (picked.label && opt.textContent?.trim() === picked.label) || opt.value === picked.value,
        ) ||
        Array.from(select.options).find((opt) =>
          picked.label ? (opt.textContent ?? "").toLowerCase().includes(picked.label.toLowerCase()) : false,
        );
      if (!match) return false;
      select.value = match.value;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, { label: choice.label ?? "", value: choice.value ?? "" });
    if (!ok) throw new Error("selectOption did not match");
  }

  async setInputFiles(file: HostFilePayload): Promise<void> {
    const handle = await this.firstHandle();
    if (!handle) throw new Error(`No file input for ${this.selector}`);
    const path = await writeTempUpload(file);
    try {
      await (handle as ElementHandle<HTMLInputElement>).uploadFile(path);
      await delay(150);
    } finally {
      await rm(path, { force: true }).catch(() => undefined);
    }
  }
}

export class HostPage {
  readonly keyboard: {
    type: (text: string, opts?: { delay?: number }) => Promise<void>;
    press: (key: string) => Promise<void>;
    down: (key: string) => Promise<void>;
    up: (key: string) => Promise<void>;
  };

  constructor(
    readonly raw: PuppeteerPage,
    private readonly frame?: PuppeteerFrame,
  ) {
    this.keyboard = {
      type: (text, opts) => raw.keyboard.type(text, { delay: opts?.delay }),
      press: async (key) => {
        if (key === "Control+A" || key === "Meta+A") {
          await raw.keyboard.down("Control");
          await raw.keyboard.press("KeyA");
          await raw.keyboard.up("Control");
          return;
        }
        const mapped =
          key === "Enter"
            ? "Enter"
            : key === "Tab"
              ? "Tab"
              : key === "Escape"
                ? "Escape"
                : key === "Backspace"
                  ? "Backspace"
                  : key;
        await raw.keyboard.press(mapped as Parameters<PuppeteerPage["keyboard"]["press"]>[0]);
      },
      down: (key) => raw.keyboard.down(key as Parameters<PuppeteerPage["keyboard"]["down"]>[0]),
      up: (key) => raw.keyboard.up(key as Parameters<PuppeteerPage["keyboard"]["up"]>[0]),
    };
  }

  private get queryRoot(): QueryRoot {
    return this.frame ?? this.raw;
  }

  url(): string {
    return this.frame ? this.frame.url() : this.raw.url();
  }

  locator(selector: string): HostLocator {
    return new HostLocator(this, this.queryRoot, selector);
  }

  getByRole(role: string, opts?: { name?: string | RegExp }): HostLocator {
    return new HostLocator(this, this.queryRoot, selectorForRole(role), opts?.name ? { roleName: opts.name } : {});
  }

  getByText(pattern: string | RegExp): HostLocator {
    return new HostLocator(this, this.queryRoot, "body *", { hasText: pattern });
  }

  getByLabel(pattern: string | RegExp): HostLocator {
    return new HostLocator(
      this,
      this.queryRoot,
      'input, textarea, select, [role="textbox"], [role="combobox"], [role="listbox"]',
      { roleName: pattern },
    );
  }

  frames(): HostPage[] {
    return this.raw.frames().map((frame) => new HostPage(this.raw, frame));
  }

  async goto(url: string, opts?: { waitUntil?: "domcontentloaded" | "load"; timeout?: number }): Promise<void> {
    await this.raw.goto(url, { waitUntil: opts?.waitUntil ?? "domcontentloaded", timeout: opts?.timeout ?? 60_000 });
  }

  async evaluate<T, Arg = unknown>(fn: (arg: Arg) => T, arg?: Arg): Promise<T> {
    const target = this.frame ?? this.raw;
    // Puppeteer stringifies `fn` into the page. esbuild/tsx (and some minifiers)
    // inject a free `__name` helper into nested functions; bind it in the wrapper
    // so capture/apply/next still run.
    const wrapped = new Function(
      "arg",
      `"use strict";
      const __defProp = Object.defineProperty;
      const __name = (target, value) => {
        try { __defProp(target, "name", { value, configurable: true }); } catch {}
        return target;
      };
      return (${fn.toString()})(arg);`,
    ) as (arg: Arg) => T;
    return target.evaluate(wrapped as (arg: unknown) => T, arg as unknown);
  }

  async waitForTimeout(ms: number): Promise<void> {
    await delay(ms);
  }

  async waitForLoadState(_state?: "domcontentloaded" | "load", opts?: { timeout?: number }): Promise<void> {
    await this.raw
      .waitForFunction(() => document.readyState !== "loading", { timeout: opts?.timeout ?? 45_000 })
      .catch(() => undefined);
  }

  async waitForEvent(event: "filechooser", opts?: { timeout?: number }): Promise<HostFileChooser> {
    if (event !== "filechooser") throw new Error(`Unsupported event ${event}`);
    const chooser = await this.raw.waitForFileChooser({ timeout: opts?.timeout ?? 5_000 });
    return new HostFileChooser((paths) => chooser.accept(paths));
  }

  async close(): Promise<void> {
    await this.raw.close().catch(() => undefined);
  }
}

export async function launchHostBrowser(): Promise<{ browser: Browser; page: HostPage }> {
  const puppeteerMod = await import("puppeteer");
  const puppeteer = puppeteerMod.default ?? puppeteerMod;
  const browser = await puppeteer.launch({
    headless: true,
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  });
  const raw = await browser.newPage();
  await raw.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  await raw.setViewport({ width: 1280, height: 900 });
  return { browser, page: new HostPage(raw) };
}

export type Page = HostPage;
export type Locator = HostLocator;
export type Frame = HostPage;
