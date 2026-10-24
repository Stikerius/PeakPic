import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import { SLOW_FRAME_MS, WATCH_FRAMES, ambientFor, ambientState, tooSlow, type AmbientVariant } from "../../../admin-web/src/lib/ambient";
import type { Route } from "../../../admin-web/src/lib/router";

const ROOT = join(__dirname, "../../../admin-web/src");
const css = readFileSync(join(ROOT, "styles.css"), "utf8");

const ROUTES: Route[] = [
  { page: "overview" },
  { page: "queue" },
  { page: "report", id: "x" },
  { page: "users" },
  { page: "user", id: "x" },
  { page: "audit" },
  { page: "legal" },
  { page: "legal-edit", id: "x" },
  { page: "pending" },
  { page: "usage" },
  { page: "reset" },
  { page: "reset-job", id: "x" },
  { page: "mail" },
  { page: "mail-campaign", id: "x" },
  { page: "logos" },
  { page: "design" },
];

describe("which page gets which background", () => {
  it("every page has a variant, matching its purpose", () => {
    const map = Object.fromEntries(ROUTES.map((r) => [r.page, ambientFor(r)]));
    expect(map).toEqual({
      overview: "contours",
      queue: "radar",
      report: "still",
      users: "network",
      user: "network",
      audit: "ledger",
      legal: "paper",
      "legal-edit": "paper",
      pending: "paper",
      usage: "streams",
      reset: "hazard",
      "reset-job": "hazard",
      mail: "flight",
      "mail-campaign": "flight",
      logos: "dots",
      design: "dots",
    });
  });
});

describe("states", () => {
  const base = { setting: "on" as const, variant: "radar" as AmbientVariant, reducedMotion: false, hidden: false, slow: false };

  it("on: moving", () => expect(ambientState(base)).toEqual({ render: true, moving: true, level: "full" }));
  it("Aus: nothing at all", () => expect(ambientState({ ...base, setting: "off" }).render).toBe(false));
  it("Ruhig: still image", () => expect(ambientState({ ...base, setting: "calm" })).toEqual({ render: true, moving: false, level: "full" }));
  it("reduce motion: still image", () => expect(ambientState({ ...base, reducedMotion: true }).moving).toBe(false));
  it("hidden tab: paused", () => expect(ambientState({ ...base, hidden: true }).moving).toBe(false));
  it("report detail: no background, no motion", () => expect(ambientState({ ...base, variant: "still" })).toEqual({ render: false, moving: false, level: "full" }));
  it("dots never move", () => expect(ambientState({ ...base, variant: "dots" })).toEqual({ render: true, moving: false, level: "full" }));
  it("slow devices get the simple level", () => expect(ambientState({ ...base, slow: true }).level).toBe("simple"));

  it("decides about slowness only after a full window of frames", () => {
    const fast = Array.from({ length: WATCH_FRAMES }, () => 16);
    const slow = Array.from({ length: WATCH_FRAMES }, (_, i) => (i % 3 === 0 ? SLOW_FRAME_MS + 10 : 16));
    expect(tooSlow(fast)).toBe(false);
    expect(tooSlow(slow)).toBe(true);
    expect(tooSlow(slow.slice(0, 10))).toBe(false);
  });
});

describe("checklist: backgrounds stay in the background", () => {
  const dir = join(ROOT, "components/ambient");
  const files = readdirSync(dir).filter((f) => f.endsWith(".tsx"));

  it("no variant contains anything interactive or focusable", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const file of files) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source).not.toMatch(/<a[\s>]|<button|<input|<select|<textarea|tabIndex|onClick|onKey|href=|role="button"|dangerouslySetInnerHTML/);
    }
  });

  it("the layer is aria-hidden, behind the content and never takes the pointer", () => {
    const wrapper = readFileSync(join(dir, "AmbientBackground.tsx"), "utf8");
    expect(wrapper).toContain('aria-hidden="true"');
    expect(css).toMatch(/\.ambient \{[^}]*position: fixed;[^}]*z-index: 0;[^}]*pointer-events: none;/);
    expect(css).toMatch(/\.main \{ position: relative; z-index: 1; \}/);
    expect(css).toMatch(/\.ambient\[data-moving="false"\] \*[^{]*\{ animation-play-state: paused !important; \}/);
  });

  it("the animations move only transform and opacity", () => {
    const blocks = [...css.matchAll(/@keyframes (amb-[\w-]+) \{([\s\S]*?)\}\s*(?=\n[^\s]|$)/g)];
    expect(blocks.length).toBeGreaterThanOrEqual(9);
    for (const [, name, body] of blocks) {
      const properties = [...(body ?? "").matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      for (const property of properties) expect([name, property]).toEqual([name, expect.stringMatching(/^(transform|opacity)$/)]);
    }
  });

  it("reduce motion stops every animation", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{ transition: none !important; animation: none !important; \}/);
  });

  it("content areas always have an opaque surface", () => {
    for (const selector of [".panel", ".card", ".table", ".dialog", ".auth-card", ".logo-tile", ".appearance-panel", ".table-scroll"]) {
      const rule = new RegExp(`(^|\\n)${selector.replace(".", "\\.")} \\{[^}]*background: var\\(--surface\\)`);
      expect([selector, rule.test(css)]).toEqual([selector, true]);
    }
    expect(css).toMatch(/:root\[data-style="new"\] \.filters \{[^}]*background: var\(--surface\)/);
    expect(css).toMatch(/\.notice \{[^}]*background: var\(--warn-bg\)/);
  });
});
