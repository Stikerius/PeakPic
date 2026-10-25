/**
 * @jest-environment jsdom
 */
// Renders the dashboard's animation studio in jsdom with the dashboard's own React and plays through
// the main steps (tracks, keyboard editing, undo, easing, templates, per-shape and colour
// rendering, A-B comparison, the simple tab). Fails on any React warning.
import { afterAll, beforeAll, expect, it, jest } from "@jest/globals";

jest.mock("../../../admin-web/src/lib/supabase", () => ({
  SIGNED_URL_SECONDS: 60,
  supabase: { rpc: () => Promise.resolve({ data: null, error: null }), functions: { invoke: () => Promise.resolve({}) } },
}));

// The dashboard's React and components are loaded with require and typed by hand here, so the
// app's typecheck doesn't pull in the dashboard's Vite types.
type Node = unknown;
type ReactLike = { createElement: (type: unknown, props: unknown, ...children: Node[]) => Node; act: (fn: () => Promise<unknown>) => Promise<void> };
type RootLike = { render: (node: Node) => void; unmount: () => void };
/* eslint-disable @typescript-eslint/no-require-imports */
const React = require("../../../admin-web/node_modules/react") as ReactLike;
const { createRoot } = require("../../../admin-web/node_modules/react-dom/client") as { createRoot: (el: Element) => RootLike };
const { act } = React;
const { AnimationStudio } = require("../../../admin-web/src/components/animation/AnimationStudio") as { AnimationStudio: unknown };
const { AppearanceProvider } = require("../../../admin-web/src/lib/appearanceContext") as { AppearanceProvider: unknown };
const brand = require("../../../shared/brand") as typeof import("../../../shared/brand");

const errors: unknown[] = [];
const original = console.error;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // The preview autoplays; a frozen frame clock keeps the playhead at 0 so the keyframe positions don't depend on machine speed.
  window.requestAnimationFrame = () => 0;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
  console.error = (...args: unknown[]) => {
    errors.push(args);
    original(...args);
  };
});
afterAll(() => {
  console.error = original;
});

function fire(el: Element, type: string, init: Record<string, unknown> = {}) {
  const event = type.startsWith("key") ? new KeyboardEvent(type, { bubbles: true, ...init }) : new Event(type, { bubbles: true });
  el.dispatchEvent(event);
}

it("renders and edits without errors", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const presets = brand.BUILTIN_PRESETS.map((p) => ({ id: p.id, name: p.name, kind: "builtin" as const, animation: brand.migrateV1(p.params), params: p.params, usedBy: 1, versions: 0 }));
  let dirty = false;
  const h = React.createElement;
  await act(async () => {
    root.render(
      h(AppearanceProvider, null,
        h(AnimationStudio, {
          spec: brand.APP_LOGO_SPEC,
          presets,
          presetId: presets[0]?.id ?? "",
          onSelect: () => undefined,
          onSaved: async () => undefined,
          onDirtyChange: (d: boolean) => {
            dirty = d;
          },
        }),
      ),
    );
  });
  const text = () => container.textContent ?? "";
  expect(text()).toContain("Spur 1");
  expect(container.querySelectorAll(".timeline-lane")).toHaveLength(brand.STANDARD_ANIMATION.tracks.length);

  // Add a rotate track.
  const addButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Spur hinzufügen");
  await act(async () => addButton?.click());
  expect(container.querySelectorAll(".timeline-lane")).toHaveLength(brand.STANDARD_ANIMATION.tracks.length + 1);
  expect(dirty).toBe(true);

  // Keyboard on the last lane: add at the playhead, move right, value up.
  const lanes = container.querySelectorAll(".timeline-lane");
  const last = lanes[lanes.length - 1] as HTMLElement;
  await act(async () => last.focus());
  await act(async () => fire(last, "keydown", { key: "Enter" }));
  await act(async () => fire(last, "keydown", { key: "ArrowRight", shiftKey: true }));
  await act(async () => fire(last, "keydown", { key: "ArrowUp" }));
  expect(last.getAttribute("aria-label")).toMatch(/ausgewählt: Keyframe 1 bei 25 %/);

  // Undo all, the preset is clean again.
  const undoButton = () => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Rückgängig");
  for (let i = 0; i < 4; i += 1) await act(async () => undoButton()?.click());
  expect(dirty).toBe(false);

  // Easing type switch on a selected keyframe.
  const firstLane = container.querySelector(".timeline-lane") as HTMLElement;
  await act(async () => firstLane.focus());
  await act(async () => fire(firstLane, "keydown", { key: "]" }));
  const typeSelect = Array.from(container.querySelectorAll("select")).find((s) => s.closest("fieldset")?.querySelector("legend")?.textContent?.includes("Easing"));
  if (typeSelect !== undefined) {
    typeSelect.value = "bezier";
    await act(async () => fire(typeSelect, "change"));
  }
  expect(container.querySelectorAll(".easing-handle").length).toBeGreaterThanOrEqual(2);

  // Template and the simple tab.
  const templateSelect = Array.from(container.querySelectorAll("select")).find((s) => s.querySelector('option[value="sparkle"]') !== null);
  if (templateSelect !== undefined) {
    templateSelect.value = "sparkle";
    await act(async () => fire(templateSelect, "change"));
  }
  expect(container.querySelectorAll("[data-spark]").length).toBeGreaterThan(0);
  // Per-shape rendering (staggered draw) and a colour track.
  if (templateSelect !== undefined) {
    templateSelect.value = "draw-rotate";
    await act(async () => fire(templateSelect, "change"));
  }
  expect(container.querySelectorAll("[data-shape-outline]").length).toBe(brand.APP_LOGO_SPEC.shapes.length);
  const kindSelect = Array.from(container.querySelectorAll("select")).find((s) => s.querySelector('option[value="color"]') !== null && s.querySelector('option[value="rotate"]') !== null);
  if (kindSelect !== undefined) {
    kindSelect.value = "color";
    await act(async () => fire(kindSelect, "change"));
  }
  await act(async () => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Spur hinzufügen")?.click());
  await act(async () => new Promise((r) => setTimeout(r, 100)));
  const rects = container.querySelectorAll("[data-shape-rect]");
  expect(rects.length).toBeGreaterThan(0);
  expect(rects[0]?.getAttribute("fill")).toMatch(/^#[0-9a-f]{6}$/);
  // A-B comparison: two previews.
  await act(async () => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Als A merken")?.click());
  const compare = Array.from(container.querySelectorAll("label")).find((l) => l.textContent === "A-B-Vergleich")?.querySelector("input");
  await act(async () => compare?.click());
  expect(container.querySelectorAll(".ab-previews figure")).toHaveLength(2);

  const simpleTab = Array.from(container.querySelectorAll('[role="tab"]')).find((b) => b.textContent === "Einfach") as HTMLElement;
  await act(async () => simpleTab.click());
  expect(text()).toContain("Linie zeichnen");

  // Let a few animation frames run.
  await act(async () => new Promise((r) => setTimeout(r, 200)));
  await act(async () => root.unmount());
  expect(errors).toEqual([]);
}, 30000); // heavy render: generous under parallel load

it("stays usable at the limits: 16 tracks with 12 keyframes each", async () => {
  // The largest animation the server accepts, built from the standard tracks.
  const base = brand.migrateV1(brand.BUILTIN_PRESETS[0]!.params);
  // One dot grid at most: repeat only the other kinds.
  const repeatable = base.tracks.filter((t) => t.kind !== "dots" && t.kind !== "sparks");
  const tracks = Array.from({ length: brand.ANIMATION_LIMITS.tracks }, (_, i) => {
    const track = i < base.tracks.length ? base.tracks[i]! : repeatable[i % repeatable.length]!;
    const first = track.keyframes[0]!;
    const keyframes = Array.from({ length: brand.ANIMATION_LIMITS.keyframes }, (_, k) => ({ ...first, t: k / (brand.ANIMATION_LIMITS.keyframes - 1) }));
    return { ...track, keyframes };
  });
  const check = brand.validateAnimationSpec({ ...base, tracks });
  if (!check.ok) throw new Error(check.error);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const presets = [{ id: "max", name: "Maximum", kind: "custom" as const, animation: check.spec, params: brand.BUILTIN_PRESETS[0]!.params, usedBy: 0, versions: 0 }];
  const started = Date.now();
  await act(async () => {
    root.render(
      React.createElement(AppearanceProvider, null,
        React.createElement(AnimationStudio, { spec: brand.APP_LOGO_SPEC, presets, presetId: "max", onSelect: () => undefined, onSaved: async () => undefined, onDirtyChange: () => undefined }),
      ),
    );
  });
  const renderMs = Date.now() - started;
  expect(container.querySelectorAll(".timeline-lane")).toHaveLength(16);
  expect(container.querySelectorAll(".timeline-lane .keyframe")).toHaveLength(16 * 12);
  // Keyboard editing on the last lane still answers quickly.
  const lanes = container.querySelectorAll(".timeline-lane");
  const last = lanes[lanes.length - 1] as HTMLElement;
  const editStart = Date.now();
  await act(async () => fire(last, "keydown", { key: "]" }));
  await act(async () => fire(last, "keydown", { key: "ArrowUp" }));
  const editMs = Date.now() - editStart;
  // Generous bounds (jsdom, parallel tests): they catch an accidental blow-up, not small changes.
  expect(renderMs).toBeLessThan(8000);
  expect(editMs).toBeLessThan(3000);
  await act(async () => root.unmount());
  expect(errors).toEqual([]);
}, 30000);
