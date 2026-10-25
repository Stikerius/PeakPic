import { describe, expect, it, jest } from "@jest/globals";

import {
  parseOfficialItem,
  parseSnapshot,
  parseSurvey,
  remainingText,
  type OfficialItem,
  type SurveyQuestion,
} from "../../../shared/surveys";
import { mergeFeed, surveyRowSubtitle, withAnswered, withSeen, withoutItem, type OfficialFeed } from "@/lib/surveyFeed";
import { OWN_ANSWERS_LIMIT, parseOwnAnswersStore, withOwnAnswers } from "@/lib/myAnswers";
import { answersToSend, canContinue, classifySubmitError, formatOwnAnswer, isDirty, progressText, toggleChoice } from "@/lib/surveyFlow";
import type { FeedPost } from "@/types/social";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest mock factory
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const serverItem = (n: number, change: Record<string, unknown> = {}) => ({
  item_id: ID(n),
  kind: "survey",
  survey_id: ID(100 + n),
  title: `Umfrage ${n}`,
  topic: "Worum es geht, in ein paar Worten.",
  state: "active",
  starts_at: "2026-10-01T10:00:00Z",
  ends_at: "2026-10-30T10:00:00Z",
  published_at: `2026-10-${String(10 + n).padStart(2, "0")}T10:00:00Z`,
  feed_until: "2026-11-30T10:00:00Z",
  profile_until: null,
  pin_until_answered: false,
  answered: false,
  question_count: 3,
  media: [],
  snapshot: null,
  seen: false,
  ...change,
});

const item = (n: number, change: Record<string, unknown> = {}): OfficialItem => {
  const parsed = parseOfficialItem(serverItem(n, change));
  if (parsed === null) throw new Error("fixture");
  return parsed;
};

const post = (day: number): FeedPost =>
  ({ feedKey: `p${day}`, id: `p${day}`, createdAt: `2026-10-${String(day).padStart(2, "0")}T12:00:00Z` }) as FeedPost;

const snapshot = {
  version: 1,
  title: "Ergebnis",
  conclusion: "Die meisten trainieren wöchentlich.",
  participants: 42,
  participationRate: 0.3,
  closedAt: "2026-10-20T10:00:00Z",
  questions: [{ prompt: "Wie oft?", kind: "single", answered: 42, options: [{ label: "Wöchentlich", count: 30, percent: 71.4 }], mean: null, median: null, nps: null, quotes: [] }],
  media: [],
};

describe("feed: official cards", () => {
  it("cards on top first, the others between the posts by date", () => {
    const feed: OfficialFeed = { top: [item(9)], items: [item(5), item(2)] };
    const entries = mergeFeed([post(18), post(14), post(12)], feed, true);
    expect(entries.map((e) => e.key)).toEqual([`official:${ID(9)}`, "p18", `official:${ID(5)}`, "p14", "p12"]);
  });

  it("cards older than the loaded posts wait until there are no more posts", () => {
    const feed: OfficialFeed = { top: [], items: [item(1)] };
    expect(mergeFeed([post(18)], feed, true).map((e) => e.key)).toEqual(["p18"]);
    expect(mergeFeed([post(18)], feed, false).map((e) => e.key)).toEqual(["p18", `official:${ID(1)}`]);
    // An empty feed still shows them (the feed never waits for the cards and vice versa).
    expect(mergeFeed([], feed, false)).toHaveLength(1);
  });

  it("later / seen: off the top, unless pinned until answered", () => {
    const normal = item(3);
    const pinned = item(4, { pin_until_answered: true });
    const after = withSeen({ top: [normal, pinned], items: [] }, normal.itemId);
    expect(after.top.map((i) => i.itemId)).toEqual([pinned.itemId]);
    expect(after.items[0]).toMatchObject({ itemId: normal.itemId, seen: true });
    expect(withSeen(after, pinned.itemId).top.map((i) => i.itemId)).toEqual([pinned.itemId]);
  });

  it("answered: the survey card leaves the feed at once, other cards stay", () => {
    const pinned = item(4, { pin_until_answered: true });
    const other = item(5);
    const after = withAnswered({ top: [pinned], items: [other] }, pinned.surveyId);
    expect(after).toEqual({ top: [], items: [other] });
  });

  it("dismissed: gone everywhere", () => {
    const a = item(1);
    const b = item(2);
    expect(withoutItem({ top: [a], items: [b] }, a.itemId)).toEqual({ top: [], items: [b] });
  });

  it("settings row text", () => {
    expect(surveyRowSubtitle(item(1), new Date("2026-10-27T10:00:00Z"))).toBe("Offen · noch 3 Tage");
    expect(surveyRowSubtitle(item(1, { answered: true }), new Date("2026-10-30T09:30:00Z"))).toBe("Teilgenommen · noch 30 Minuten");
  });
});

describe("what the app takes from the server", () => {
  it("only known fields; e-mail, ids of people or raw answers never reach the app", () => {
    const parsed = parseOfficialItem(serverItem(1, { email: "x@example.invalid", user_id: ID(77), answers: [{ value: 1 }], created_by: ID(78) }));
    const keys = Object.keys(parsed ?? {});
    expect(keys).not.toEqual(expect.arrayContaining(["email"]));
    for (const forbidden of ["email", "user_id", "answers", "created_by"]) expect(keys).not.toContain(forbidden);
    expect(JSON.stringify(parsed)).not.toMatch(/example\.invalid|0000000000(77|78)/);
  });

  it("broken items and snapshots are dropped, nothing half shown", () => {
    expect(parseOfficialItem(serverItem(1, { kind: "evil" }))).toBeNull();
    expect(parseOfficialItem(serverItem(1, { published_at: "gestern" }))).toBeNull();
    expect(parseOfficialItem(serverItem(1, { kind: "results", snapshot: { ...snapshot, version: 2 } }))).toBeNull();
    const results = parseOfficialItem(serverItem(1, { kind: "results", snapshot }));
    expect(results?.snapshot?.participants).toBe(42);
    expect(results?.topic).toBeNull();
  });

  it("snapshot: limits and only checked values", () => {
    expect(parseSnapshot({ ...snapshot, conclusion: "x".repeat(601) })).toBeNull();
    const many = parseSnapshot({ ...snapshot, questions: Array.from({ length: 15 }, () => snapshot.questions[0]) });
    expect(many?.questions).toHaveLength(10);
    const bad = parseSnapshot({ ...snapshot, questions: [{ ...snapshot.questions[0], options: [{ label: "x", count: 1, percent: 140 }] }] });
    expect(bad?.questions[0]?.options).toEqual([]);
    const media = parseSnapshot({ ...snapshot, media: [{ kind: "image", path: "../../etc/passwd", alt_text: "x" }, { kind: "image", path: `survey/${ID(1)}/results-${ID(2)}.png`, alt_text: "Bild" }] });
    expect(media?.media.map((m) => m.path)).toEqual([`survey/${ID(1)}/results-${ID(2)}.png`]);
  });

  it("questions that break the rules are not shown", () => {
    const survey = parseSurvey({
      survey_id: ID(1),
      title: "T",
      topic: "Thema der Umfrage",
      state: "active",
      ends_at: null,
      allow_text: false,
      questions: [
        { id: ID(2), kind: "single", prompt: "Eins?", required: true, options: ["a", "b"] },
        { id: ID(3), kind: "text", prompt: "Text?", required: false, text_max: 100 },
        { id: ID(4), kind: "single", prompt: "Kaputt?", required: true, options: ["nur eine"] },
      ],
    });
    expect(survey?.questions.map((q) => q.id)).toEqual([ID(2)]);
  });

  it("time left", () => {
    const now = new Date("2026-10-27T10:00:00Z");
    expect(remainingText("2026-10-30T10:00:00Z", now)).toBe("noch 3 Tage");
    expect(remainingText("2026-10-28T09:00:00Z", now)).toBe("noch 23 Stunden");
    expect(remainingText("2026-10-27T11:00:00Z", now)).toBe("noch 1 Stunde");
    expect(remainingText("2026-10-27T10:00:30Z", now)).toBe("endet gleich");
    expect(remainingText("2026-10-27T09:00:00Z", now)).toBe("beendet");
  });
});

describe("taking part", () => {
  const q = (change: Partial<SurveyQuestion>): SurveyQuestion => ({
    id: "q",
    kind: "single",
    prompt: "Wie oft?",
    required: true,
    options: ["a", "b", "c"],
    maxChoices: null,
    scaleMin: null,
    scaleMax: null,
    textMax: null,
    ...change,
  });

  it("required questions block 'Weiter', optional ones don't", () => {
    expect(canContinue(q({}), undefined, false)).toBe(false);
    expect(canContinue(q({}), 1, false)).toBe(true);
    expect(canContinue(q({ required: false }), undefined, false)).toBe(true);
    expect(canContinue(q({ kind: "text", options: null, textMax: 20, required: true }), "   ", true)).toBe(false);
    expect(canContinue(q({ kind: "text", options: null, textMax: 20, required: false }), "x".repeat(21), true)).toBe(false);
  });

  it("multiple choice respects the limit and keeps the order", () => {
    const multi = q({ kind: "multiple", maxChoices: 2 });
    let value: unknown = [];
    value = toggleChoice(multi, value, 2);
    value = toggleChoice(multi, value, 0);
    expect(value).toEqual([0, 2]);
    expect(toggleChoice(multi, value, 1)).toEqual([0, 2]);
    expect(toggleChoice(multi, value, 2)).toEqual([0]);
  });

  it("sends only real answers, trimmed; dirty as soon as something is entered", () => {
    const questions = [q({ id: "a" }), q({ id: "b", kind: "text", options: null, textMax: 50, required: false })];
    expect(isDirty(questions, {})).toBe(false);
    expect(isDirty(questions, { b: "  " })).toBe(false);
    expect(isDirty(questions, { a: 0 })).toBe(true);
    expect(answersToSend(questions, { a: 0, b: "  gut  " }, true)).toEqual({ a: 0, b: "gut" });
    expect(answersToSend(questions, { a: 0, b: "   " }, true)).toEqual({ a: 0 });
    expect(answersToSend(questions, { b: "gut" }, true)).toBeNull();
  });

  it("what a failed send means: ended, already, invalid, network (answers kept)", () => {
    expect(classifySubmitError({ message: "survey_not_active" })).toBe("ended");
    expect(classifySubmitError({ message: "survey_not_found" })).toBe("ended");
    expect(classifySubmitError({ message: "already_answered" })).toBe("already");
    expect(classifySubmitError({ message: "required_missing" })).toBe("invalid");
    expect(classifySubmitError(new TypeError("Network request failed"))).toBe("network");
    expect(classifySubmitError(undefined)).toBe("network");
    expect(progressText(1, 5)).toBe("Frage 2 von 5");
  });
});

describe("own answers (only on this device)", () => {
  const q = (kind: SurveyQuestion["kind"], change: Partial<SurveyQuestion> = {}): SurveyQuestion => ({
    id: kind,
    kind,
    prompt: "Frage?",
    required: false,
    options: kind === "single" || kind === "multiple" ? ["Selten", "Oft", "Täglich"] : null,
    maxChoices: kind === "multiple" ? 2 : null,
    scaleMin: kind === "scale" ? 0 : null,
    scaleMax: kind === "scale" ? 10 : null,
    textMax: kind === "text" ? 200 : null,
    ...change,
  });

  it("formats every kind, and skipped questions", () => {
    expect(formatOwnAnswer(q("single"), 1)).toBe("Oft");
    expect(formatOwnAnswer(q("multiple"), [0, 2])).toBe("Selten, Täglich");
    expect(formatOwnAnswer(q("scale"), 7)).toBe("7 (Skala 0 bis 10)");
    expect(formatOwnAnswer(q("yes_no"), false)).toBe("Nein");
    expect(formatOwnAnswer(q("text"), "Mehr Pläne")).toBe("Mehr Pläne");
    expect(formatOwnAnswer(q("text"), undefined)).toBe("Nicht beantwortet");
    expect(formatOwnAnswer(q("multiple"), [])).toBe("Nicht beantwortet");
  });

  it("stores per survey, keeps the newest, survives broken data", () => {
    let store = parseOwnAnswersStore(null);
    for (let i = 0; i < OWN_ANSWERS_LIMIT + 3; i += 1) {
      store = withOwnAnswers(store, `s${i}`, { q: i }, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString());
    }
    expect(Object.keys(store)).toHaveLength(OWN_ANSWERS_LIMIT);
    expect(store.s0).toBeUndefined();
    expect(store[`s${OWN_ANSWERS_LIMIT + 2}`]?.answers).toEqual({ q: OWN_ANSWERS_LIMIT + 2 });
    expect(parseOwnAnswersStore(JSON.stringify(store))).toEqual(store);
    expect(parseOwnAnswersStore("{kaputt")).toEqual({});
    expect(parseOwnAnswersStore(JSON.stringify({ a: { savedAt: 1, answers: {} }, b: { savedAt: "x", answers: [] } }))).toEqual({});
  });
});
