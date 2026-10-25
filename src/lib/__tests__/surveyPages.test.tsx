/**
 * @jest-environment jsdom
 */
// Renders the dashboard's survey pages in jsdom with the dashboard's own React (API mocked):
// the editor wizard step by step, the list with its actions, the evaluation (table = chart,
// minimum count, hiding free text). Fails on any React warning.
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("../../../admin-web/src/lib/supabase", () => ({
  SIGNED_URL_SECONDS: 60,
  supabase: { rpc: () => Promise.resolve({ data: null, error: null }) },
}));

const mockApi = {
  fetchSurveyList: jest.fn(),
  fetchSurveyDetail: jest.fn(),
  saveSurvey: jest.fn(),
  fetchSurveyResults: jest.fn(),
  hideSurveyText: jest.fn(),
  signSurveyImages: () => Promise.resolve(new Map()),
  fetchLogos: () => Promise.resolve([]),
  fetchDashboardLogo: () => Promise.resolve(null),
  addSurveyLogo: jest.fn(),
  deleteSurvey: jest.fn(),
  withdrawItem: jest.fn(),
  previewResults: jest.fn(),
  publishResults: jest.fn(),
  removeSurveyMedia: jest.fn(),
  updateSurveyMedia: jest.fn(),
  uploadSurveyImage: jest.fn(),
  extendSurvey: jest.fn(),
  cancelSurvey: jest.fn(),
  publishSurvey: jest.fn(),
  verifyTotpAgain: jest.fn(),
  fetchSurveyStats: jest.fn(),
};
jest.mock("../../../admin-web/src/lib/api", () => mockApi);

type Node = unknown;
type ReactLike = { createElement: (type: unknown, props: unknown, ...children: Node[]) => Node; act: (fn: () => Promise<unknown>) => Promise<void> };
type RootLike = { render: (node: Node) => void; unmount: () => void };
/* eslint-disable @typescript-eslint/no-require-imports -- the dashboard's React and modules, loaded after the mocks */
const React = require("../../../admin-web/node_modules/react") as ReactLike;
const { createRoot } = require("../../../admin-web/node_modules/react-dom/client") as { createRoot: (el: Element) => RootLike };
const { AppearanceProvider } = require("../../../admin-web/src/lib/appearanceContext") as { AppearanceProvider: unknown };
const { DashboardBrandProvider } = require("../../../admin-web/src/lib/dashboardBrand") as { DashboardBrandProvider: unknown };
const { SurveyEditorPage } = require("../../../admin-web/src/pages/SurveyEditorPage") as { SurveyEditorPage: unknown };
const { SurveysPage } = require("../../../admin-web/src/pages/SurveysPage") as { SurveysPage: unknown };
const { SurveyResultsPage } = require("../../../admin-web/src/pages/SurveyResultsPage") as { SurveyResultsPage: unknown };
const { draftFromServer } = require("../../../admin-web/src/lib/surveyAdmin") as typeof import("../../../admin-web/src/lib/surveyAdmin");
/* eslint-enable @typescript-eslint/no-require-imports */
const { act } = React;
const h = React.createElement;

const errors: unknown[] = [];
const original = console.error;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  console.error = (...args: unknown[]) => {
    errors.push(args);
    original(...args);
  };
});
afterAll(() => {
  console.error = original;
});
beforeEach(() => {
  errors.length = 0;
  jest.clearAllMocks();
});

async function render(page: unknown, props: Record<string, unknown>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(h(AppearanceProvider, null, h(DashboardBrandProvider, { mode: "light", palette: "color" }, h(page, props))));
  });
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  return { container, root };
}

const text = (c: Element) => c.textContent ?? "";
/** Controls a screen reader can't name: fields without a label, buttons without text or aria-label. */
function unnamed(root: Element): string[] {
  const named = (el: Element) =>
    (el.getAttribute("aria-label") ?? "").trim() !== "" ||
    el.hasAttribute("aria-labelledby") ||
    el.closest("label") !== null ||
    (el.id !== "" && root.ownerDocument.querySelector(`label[for="${el.id}"]`) !== null);
  const fields = Array.from(root.querySelectorAll("input, select, textarea")).filter((el) => (el as HTMLInputElement).type !== "hidden" && !named(el));
  const buttons = Array.from(root.querySelectorAll("button")).filter((b) => (b.textContent ?? "").trim() === "" && !named(b));
  return [...fields, ...buttons].map((el) => el.outerHTML.slice(0, 120));
}
const button = (c: Element, label: string) => Array.from(c.querySelectorAll("button, a")).find((b) => b.textContent?.trim() === label) as HTMLElement | undefined;
function type(el: Element | null, value: string) {
  if (el === null) throw new Error("no field");
  const input = el as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
const later = (days: number) => {
  const d = new Date(Date.now() + days * 86400000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

describe("survey editor", () => {
  it("steps: 'Weiter' needs the required fields, saves the draft, ends at publishing", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    mockApi.saveSurvey.mockImplementation(() => Promise.resolve(id));
    const server = { id, title: "Wie gefällt dir PeakPic?", topic: "Wir möchten wissen, was dir gefällt.", ends_at: new Date(Date.now() + 7 * 86400000).toISOString(), questions: [{ kind: "yes_no", prompt: "Gefällt dir die App?", required: true }], feed_days: 7, profile_days: 90 };
    mockApi.fetchSurveyDetail.mockImplementation(() =>
      Promise.resolve({ draft: draftFromServer(server), state: "draft", locked: false, participants: 0, responses: 0, eligibleNow: 42, eligibleStart: null, publishedAt: null, startsAt: null, endsAt: server.ends_at, cancelKeepAnswers: false, media: [], items: [] }),
    );
    const { container, root } = await render(SurveyEditorPage, { id: null });
    const weiter = () => button(container, "Weiter") as HTMLButtonElement;
    expect(weiter().disabled).toBe(true);
    expect(text(container)).toContain("Titel mit 3 bis 120 Zeichen.");
    expect(unnamed(container)).toEqual([]);

    const inputs = container.querySelectorAll("input, textarea");
    await act(async () => type(inputs[0] ?? null, "Wie gefällt dir PeakPic?"));
    await act(async () => type(container.querySelector("textarea"), "Wir möchten wissen, was dir gefällt."));
    await act(async () => type(container.querySelector('input[type="datetime-local"]'), later(7)));
    expect(text(container)).toMatch(/Dauer: 7 Tage|Dauer: 6 Tage/);
    expect(weiter().disabled).toBe(false);

    await act(async () => weiter().click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(mockApi.saveSurvey).toHaveBeenCalledTimes(1);
    expect(text(container)).toContain("Bild hinzufügen");
    expect(unnamed(container)).toEqual([]);

    await act(async () => weiter().click()); // media -> questions
    expect(text(container)).toContain("Frage 1");
    expect(unnamed(container)).toEqual([]);
    // The default question has empty answers: "Weiter" stays off until they are filled in.
    expect(weiter().disabled).toBe(true);
    // Every question type is a visible choice; "Textfeld" switches free text on by itself.
    const typeRadio = (label: string) =>
      Array.from(container.querySelectorAll(".question .segment")).find((l) => l.textContent === label)?.querySelector("input") as HTMLInputElement;
    expect(Array.from(container.querySelectorAll(".question .segment")).map((l) => l.textContent)).toEqual([
      "Eine Auswahl",
      "Mehrfachauswahl",
      "Skala",
      "Ja/Nein",
      "Textfeld",
    ]);
    await act(async () => typeRadio("Textfeld").click());
    expect(text(container)).toContain("Datenschutz: Freitext kann Personen erkennbar machen");
    expect(text(container)).toContain("Höchstlänge der Antwort");
    await act(async () => typeRadio("Mehrfachauswahl").click());
    expect(text(container)).toContain("Höchstens ankreuzbar");
    await act(async () => typeRadio("Ja/Nein").click());
    await act(async () => type(container.querySelector(".question input:not([type])"), "Gefällt dir die App?"));
    expect(weiter().disabled).toBe(false);
    await act(async () => weiter().click()); // questions -> display
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    await act(async () => weiter().click()); // display -> preview
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(text(container)).toContain("Karte im Feed");
    expect(unnamed(container)).toEqual([]);
    expect(text(container)).toContain("Teilnehmen");
    await act(async () => weiter().click()); // preview -> publish
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(text(container)).toContain("Veröffentlichen …");
    await act(async () => button(container, "Veröffentlichen …")?.click());
    expect(text(document.body)).toContain("Erreicht 42 aktive Konten");
    expect(text(document.body)).toContain("Zwei-Faktor-Code");
    expect(unnamed(document.body)).toEqual([]);
    await act(async () => root.unmount());
    expect(errors).toEqual([]);
  });
});

describe("survey list", () => {
  it("shows state, rate and the actions of each state", async () => {
    mockApi.fetchSurveyList.mockImplementation(() =>
      Promise.resolve([
        { id: "a", title: "Laufend", state: "active", startsAt: "2026-10-20T10:00:00Z", endsAt: "2026-12-30T10:00:00Z", responses: 3, participants: 3, eligibleStart: 12, locked: true },
        { id: "b", title: "Entwurf X", state: "draft", startsAt: null, endsAt: null, responses: 0, participants: 0, eligibleStart: null, locked: false },
      ]),
    );
    const { container, root } = await render(SurveysPage, {});
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(unnamed(container)).toEqual([]);
    expect(rows[0]?.textContent).toContain("Fragen gesperrt");
    expect(rows[0]?.textContent).toContain("25 %");
    expect(rows[0]?.textContent).toContain("Verlängern");
    expect(rows[0]?.textContent).not.toContain("Löschen");
    expect(rows[1]?.textContent).toContain("Löschen");
    expect(rows[1]?.textContent).not.toContain("Abbrechen");
    await act(async () => button(rows[0] as Element, "Abbrechen")?.click());
    const body = text(document.body);
    expect(body).toContain("Begründung (Pflicht");
    expect(body).toContain("Behalten");
    expect(body).toContain("Verwerfen");
    await act(async () => root.unmount());
    expect(errors).toEqual([]);
  });
});

describe("evaluation", () => {
  it("numbers, table = chart, minimum count, hiding free text", async () => {
    const results = {
      title: "Auswertung",
      state: "closed",
      allowText: true,
      cancelKeepAnswers: false,
      answersPurgedAt: null,
      participants: 4,
      responses: 4,
      eligibleStart: 10,
      eligibleEnd: 12,
      started: 5,
      reach: 8,
      perDay: [{ day: "2026-10-20", count: 4 }],
      hours: null,
      questions: [
        { questionId: "q1", kind: "single", prompt: "Wie oft?", answered: 4, distribution: [{ label: "Selten", count: 1 }, { label: "Oft", count: 3 }], mean: null, median: null, nps: null, texts: [] },
        { questionId: "q2", kind: "text", prompt: "Was fehlt?", answered: 1, distribution: [], mean: null, median: null, nps: null, texts: [{ responseId: "r1", text: "Mehr Pläne", hidden: false }] },
      ],
      resultsItems: [],
    };
    mockApi.fetchSurveyResults.mockImplementation(() => Promise.resolve(results));
    mockApi.fetchSurveyDetail.mockImplementation(() => Promise.resolve({ draft: draftFromServer({}), state: "closed", locked: true, media: [], items: [] }));
    mockApi.hideSurveyText.mockImplementation(() => Promise.resolve());
    const { container, root } = await render(SurveyResultsPage, { id: "s" });
    const all = text(container);
    expect(unnamed(container)).toEqual([]);
    expect(all).toContain("Weniger als 5 Antworten");
    expect((button(container, "Auswertung veröffentlichen …") as HTMLButtonElement).disabled).toBe(true);
    expect(all).toContain("40 %"); // 4 of 10 at the start
    expect(all).toContain("80 %"); // completion 4 of 5
    await act(async () => button(container, "Als Tabelle")?.click());
    const cells = Array.from(container.querySelectorAll(".pattern-chart table tbody tr")).map((r) => Array.from(r.querySelectorAll("td")).map((c) => c.textContent));
    expect(cells).toEqual([["Selten", "1"], ["Oft", "3"]]);
    const bars = Array.from(container.querySelectorAll(".pattern-chart svg text.strong")).map((t) => t.textContent);
    expect(bars).toEqual(["1", "3"]);
    await act(async () => button(container, "Verbergen")?.click());
    expect(mockApi.hideSurveyText).toHaveBeenCalledWith("r1", "q2", true);
    await act(async () => root.unmount());
    expect(errors).toEqual([]);
  });
});
