import { describe, expect, it } from "@jest/globals";

import {
  EDITOR_STEPS,
  actionsFor,
  chartRows,
  draftFromServer,
  draftToServer,
  incompleteQuestions,
  duplicateDraft,
  durationInfo,
  editorReducer,
  emptyDraft,
  exportCsv,
  exportSummary,
  filterSurveys,
  fromLocalInput,
  newQuestion,
  publishBlocker,
  rate,
  resizeTarget,
  shareOf,
  stepProblems,
  toLocalInput,
  type SurveyDraft,
  type SurveyResults,
} from "../../../admin-web/src/lib/surveyAdmin";

const now = new Date("2026-10-25T10:00:00Z");
const inDays = (d: number) => toLocalInput(new Date(now.getTime() + d * 86400000).toISOString());

function filled(change: Partial<SurveyDraft> = {}): SurveyDraft {
  return {
    ...emptyDraft(),
    title: "Wie gefällt dir PeakPic?",
    topic: "Wir möchten wissen, was dir gefällt.",
    endsAt: inDays(7),
    questions: [{ ...newQuestion("single"), prompt: "Wie oft?", options: ["Selten", "Oft"] }],
    ...change,
  };
}

describe("editor: required fields per step", () => {
  it("basics: title, topic, end; the period 1 hour to 90 days", () => {
    expect(stepProblems(emptyDraft(), "basics", now)).toEqual(expect.arrayContaining(["Titel mit 3 bis 120 Zeichen.", "Bitte ein Ende wählen."]));
    expect(stepProblems(filled(), "basics", now)).toEqual([]);
    expect(stepProblems(filled({ endsAt: inDays(91) }), "basics", now)).toEqual(["Höchstens 90 Tage."]);
    expect(stepProblems(filled({ endsAt: inDays(0.01) }), "basics", now)).toEqual(["Die Umfrage muss mindestens 1 Stunde laufen."]);
    expect(stepProblems(filled({ startMode: "scheduled", startsAt: "" }), "basics", now)).toContain("Bitte einen Start wählen.");
    expect(stepProblems(filled({ startMode: "scheduled", startsAt: inDays(-1) }), "basics", now)).toContain("Der Start liegt in der Vergangenheit.");
    // Once published, the dates are fixed and not checked again here.
    expect(stepProblems(filled({ endsAt: "" }), "basics", now, true)).toEqual([]);
  });

  it("questions: same rules as the server, free text only when allowed", () => {
    expect(stepProblems(filled({ questions: [] }), "questions", now)).toEqual(["Mindestens eine Frage."]);
    const text = { ...newQuestion("text"), prompt: "Was fehlt?" };
    expect(stepProblems(filled({ questions: [text] }), "questions", now)[0]).toMatch(/Freitext ist nicht erlaubt/);
    expect(stepProblems(filled({ questions: [text], allowText: true }), "questions", now)).toEqual([]);
    const dup = { ...newQuestion("single"), prompt: "Doppelt?", options: ["Ja", "ja "] };
    expect(stepProblems(filled({ questions: [dup] }), "questions", now)[0]).toMatch(/gleiche Antworten/);
    expect(stepProblems(filled({ questions: Array.from({ length: 11 }, () => filled().questions[0]!) }), "questions", now)).toContain("Höchstens 10 Fragen.");
  });

  it("display: feed 1 to 90 days, profile 1 to 3650 or unlimited", () => {
    expect(stepProblems(filled({ feedDays: 0 }), "display", now)).toEqual(["Im Feed 1 bis 90 Tage."]);
    expect(stepProblems(filled({ profileDays: null }), "display", now)).toEqual([]);
    expect(stepProblems(filled({ profileDays: 4000 }), "display", now)).toHaveLength(1);
  });

  it("duration text", () => {
    expect(durationInfo(null, new Date(now.getTime() + (2 * 24 + 3) * 3600000).toISOString(), now)).toEqual({ text: "Dauer: 2 Tage, 3 Std.", problem: null });
  });
});

describe("editor: state machine", () => {
  it("next only when the step is ready, back always, jump only to reached steps", () => {
    const empty = emptyDraft();
    let s = { step: 0, furthest: 0 };
    s = editorReducer(s, { type: "next" }, empty, now);
    expect(s.step).toBe(0);
    const draft = filled();
    for (let i = 0; i < 10; i += 1) s = editorReducer(s, { type: "next" }, draft, now);
    expect(s).toEqual({ step: EDITOR_STEPS.length - 1, furthest: EDITOR_STEPS.length - 1 });
    s = editorReducer(s, { type: "back" }, draft, now);
    expect(s.step).toBe(EDITOR_STEPS.length - 2);
    s = editorReducer(s, { type: "goto", step: 0 }, draft, now);
    expect(s.step).toBe(0);
    // Forward jump only across ready steps.
    expect(editorReducer(s, { type: "goto", step: 4 }, { ...draft, title: "" }, now).step).toBe(0);
    expect(editorReducer(s, { type: "goto", step: 4 }, draft, now).step).toBe(4);
    expect(editorReducer({ step: 0, furthest: 1 }, { type: "goto", step: 4 }, draft, now).step).toBe(0);
  });
});

describe("conversion", () => {
  it("a new draft saves without its unfinished first question (the server only stores valid ones)", () => {
    const draft = filled({ questions: emptyDraft().questions });
    expect(draft.questions).toHaveLength(1);
    expect(incompleteQuestions(draft)).toBe(1);
    expect(draftToServer(draft, true).questions).toEqual([]);
    const done = filled({ questions: [{ ...newQuestion("yes_no"), prompt: "Gefällt dir die App?" }, newQuestion("single")] });
    expect(incompleteQuestions(done)).toBe(1);
    expect((draftToServer(done, true).questions as unknown[]).length).toBe(1);
    // Published surveys send everything: the server refuses instead of silently dropping a question.
    expect((draftToServer(done).questions as unknown[]).length).toBe(2);
  });
  it("draft to server and back", () => {
    const draft = filled({
      allowText: true,
      questions: [
        { ...newQuestion("multiple"), prompt: "Was nutzt du?", options: [" Feed ", "Chats"], maxChoices: 1 },
        { ...newQuestion("scale"), prompt: "Wie zufrieden?", scale: "0-10" },
        { ...newQuestion("text"), prompt: "Was fehlt?", textMax: 120, required: false },
      ],
    });
    const server = draftToServer(draft);
    expect(server.starts_at).toBeNull();
    expect(server.questions).toEqual([
      { kind: "multiple", prompt: "Was nutzt du?", required: true, options: ["Feed", "Chats"], max_choices: 1, scale_min: null, scale_max: null, text_max: null },
      { kind: "scale", prompt: "Wie zufrieden?", required: true, options: null, max_choices: null, scale_min: 0, scale_max: 10, text_max: null },
      { kind: "text", prompt: "Was fehlt?", required: false, options: null, max_choices: null, scale_min: null, scale_max: null, text_max: 120 },
    ]);
    const back = draftFromServer({ id: "x", ...server, starts_at: null, questions: server.questions });
    expect(back.questions.map((q) => [q.kind, q.scale, q.textMax])).toEqual([["multiple", "1-5", 280], ["scale", "0-10", 280], ["text", "1-5", 120]]);
    expect(fromLocalInput(toLocalInput("2026-10-30T09:15:00.000Z"))).toBe("2026-10-30T09:15:00.000Z");
  });

  it("duplicate: new draft, no id and no dates", () => {
    const copy = duplicateDraft({ ...filled(), id: "abc", startMode: "scheduled", startsAt: inDays(1) });
    expect(copy).toMatchObject({ id: null, title: "Kopie von Wie gefällt dir PeakPic?", startMode: "now", startsAt: "", endsAt: "" });
  });
});

describe("list", () => {
  const rows = [
    { id: "1", title: "Training", state: "active" as const, startsAt: null, endsAt: null, responses: 3, participants: 3, eligibleStart: 10, locked: true },
    { id: "2", title: "Design", state: "draft" as const, startsAt: null, endsAt: null, responses: 0, participants: 0, eligibleStart: null, locked: false },
  ];

  it("filter and search", () => {
    expect(filterSurveys(rows, "active", "").map((r) => r.id)).toEqual(["1"]);
    expect(filterSurveys(rows, "all", "des").map((r) => r.id)).toEqual(["2"]);
  });

  it("actions per state; questions locked after the first answer", () => {
    expect(actionsFor({ state: "draft", locked: false })).toEqual({ edit: true, publish: true, extend: false, cancel: false, results: false, remove: true });
    expect(actionsFor({ state: "active", locked: true })).toMatchObject({ edit: false, extend: true, cancel: true, results: true, remove: false });
    expect(actionsFor({ state: "active", locked: false }).edit).toBe(true);
    expect(actionsFor({ state: "closed", locked: true })).toMatchObject({ edit: false, extend: false, cancel: false, results: true });
  });

  it("rates", () => {
    expect(rate(3, 10)).toBe(0.3);
    expect(rate(3, null)).toBeNull();
    expect(rate(30, 10)).toBe(1);
  });
});

describe("evaluation", () => {
  const results: SurveyResults = {
    title: "Umfrage",
    state: "closed",
    participants: 6,
    responses: 6,
    eligibleStart: 20,
    eligibleEnd: 24,
    started: 8,
    reach: 15,
    perDay: [{ day: "2026-10-20", count: 6 }],
    hours: null,
    questions: [
      { questionId: "a", kind: "single", prompt: "Wie oft?", answered: 6, distribution: [{ label: "Selten", count: 2 }, { label: "=HYPERLINK(\"x\")", count: 4 }], mean: null, median: null, nps: null, texts: [] },
      { questionId: "b", kind: "text", prompt: "Was fehlt?", answered: 2, distribution: [], mean: null, median: null, nps: null, texts: [{ responseId: "r1", text: "Geheime Idee", hidden: false }] },
    ],
  };

  it("at least 5 answers and an ended survey before publishing", () => {
    expect(publishBlocker({ responses: 4, state: "closed" }, false)).toMatch(/ab 5 Antworten/);
    expect(publishBlocker({ responses: 6, state: "active" }, false)).toMatch(/nach dem Ende/);
    expect(publishBlocker({ responses: 6, state: "cancelled" }, false)).toMatch(/nach dem Ende/);
    expect(publishBlocker({ responses: 6, state: "cancelled" }, true)).toBeNull();
    expect(publishBlocker({ responses: 6, state: "closed" }, false)).toBeNull();
  });

  it("export: aggregated numbers only, no free text, no days, no times", () => {
    const json = JSON.stringify(exportSummary(results));
    const csv = exportCsv(results);
    for (const text of [json, csv]) {
      expect(text).not.toContain("Geheime Idee");
      expect(text).not.toMatch(/2026-10-20|responseId|r1/);
    }
    expect(exportSummary(results)).toMatchObject({ participationRateAtStart: 0.3, participationRateAtEnd: 0.25, completionRate: 0.75 });
    // Spreadsheet formulas are neutralised.
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it("the table shows the same numbers as the chart", () => {
    const q = results.questions[0]!;
    expect(chartRows(q)).toEqual([{ label: "Selten", value: 2 }, { label: "=HYPERLINK(\"x\")", value: 4 }]);
    expect(chartRows(q).map((r) => shareOf(r.value, q.answered))).toEqual([33.3, 66.7]);
  });
});

describe("images", () => {
  it("scaled to at most 1600 pixels on the longest side", () => {
    expect(resizeTarget(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(resizeTarget(800, 600)).toEqual({ width: 800, height: 600 });
    expect(resizeTarget(1000, 5000)).toEqual({ width: 320, height: 1600 });
  });
});
