import { describe, expect, it } from "@jest/globals";

import {
  SURVEY_IMAGE_LIMITS,
  checkSurveyImage,
  cleanAltText,
  decodeBase64,
} from "../../../supabase/functions/_shared/surveyImage";
import {
  SCALES,
  answersProblem,
  cleanAnswers,
  questionProblem,
  surveyState,
  trimText,
  type SurveyQuestion,
} from "../../../shared/surveys";

describe("state from the timestamps", () => {
  const s = { publishedAt: "2026-01-01T09:00:00Z", startsAt: "2026-01-01T10:00:00Z", endsAt: "2026-01-01T12:00:00Z", cancelledAt: null };
  const at = (iso: string) => surveyState(s, new Date(iso));

  it("exact boundaries: active from the start, closed at the end", () => {
    expect(at("2026-01-01T09:59:59.999Z")).toBe("scheduled");
    expect(at("2026-01-01T10:00:00.000Z")).toBe("active");
    expect(at("2026-01-01T11:59:59.999Z")).toBe("active");
    expect(at("2026-01-01T12:00:00.000Z")).toBe("closed");
  });

  it("draft until published, cancelled wins", () => {
    expect(surveyState({ ...s, publishedAt: null }, new Date("2026-01-01T11:00:00Z"))).toBe("draft");
    expect(surveyState({ ...s, cancelledAt: "2026-01-01T10:30:00Z" }, new Date("2026-01-01T11:00:00Z"))).toBe("cancelled");
  });
});

const q = (change: Partial<SurveyQuestion>): SurveyQuestion => ({
  id: "q",
  kind: "single",
  prompt: "Wie oft?",
  required: true,
  options: ["Selten", "Oft"],
  maxChoices: null,
  scaleMin: null,
  scaleMax: null,
  textMax: null,
  ...change,
});

describe("questions", () => {
  it("valid questions of every kind", () => {
    expect(questionProblem(q({}), false)).toBeNull();
    expect(questionProblem(q({ kind: "multiple", options: ["a", "b", "c"], maxChoices: 2 }), false)).toBeNull();
    for (const [min, max] of SCALES) expect(questionProblem(q({ kind: "scale", options: null, scaleMin: min, scaleMax: max }), false)).toBeNull();
    expect(questionProblem(q({ kind: "yes_no", options: null }), false)).toBeNull();
    expect(questionProblem(q({ kind: "text", options: null, textMax: 280 }), true)).toBeNull();
  });

  it("refuses broken questions", () => {
    expect(questionProblem(q({ prompt: "ab" }), false)).toBe("invalid_prompt");
    expect(questionProblem(q({ prompt: "x".repeat(201) }), false)).toBe("invalid_prompt");
    expect(questionProblem(q({ options: ["nur eine"] }), false)).toBe("invalid_options");
    expect(questionProblem(q({ options: Array.from({ length: 11 }, (_, i) => `o${i}`) }), false)).toBe("invalid_options");
    expect(questionProblem(q({ options: ["a", "x".repeat(81)] }), false)).toBe("invalid_options");
    expect(questionProblem(q({ options: ["Ja", " ja "] }), false)).toBe("duplicate_options");
    expect(questionProblem(q({ kind: "multiple", options: ["a", "b"], maxChoices: 3 }), false)).toBe("invalid_max_choices");
    expect(questionProblem(q({ kind: "scale", options: null, scaleMin: 2, scaleMax: 7 }), false)).toBe("invalid_scale");
    expect(questionProblem(q({ kind: "text", options: null, textMax: 100 }), false)).toBe("text_not_allowed");
    expect(questionProblem(q({ kind: "text", options: null, textMax: 19 }), true)).toBe("invalid_text_max");
    expect(questionProblem(q({ kind: "yes_no" }), false)).toBe("invalid_options");
  });
});

describe("answers", () => {
  const questions: SurveyQuestion[] = [
    q({ id: "a" }),
    q({ id: "b", kind: "multiple", options: ["x", "y", "z"], maxChoices: 2, required: false }),
    q({ id: "c", kind: "scale", options: null, scaleMin: 0, scaleMax: 10 }),
    q({ id: "d", kind: "yes_no", options: null, required: false }),
    q({ id: "e", kind: "text", options: null, textMax: 20, required: false }),
  ];
  const good = { a: 1, b: [0, 2], c: 10, d: false, e: "  Gut so  " };

  it("accepts valid answers; optional ones may be missing", () => {
    expect(answersProblem(questions, good, true)).toBeNull();
    expect(answersProblem(questions, { a: 0, c: 0 }, true)).toBeNull();
    expect(answersProblem(questions, { a: 0, c: 0, b: null }, true)).toBeNull();
  });

  it("required questions, options, ranges, lengths", () => {
    expect(answersProblem(questions, { c: 1 }, true)).toBe("required_missing");
    expect(answersProblem(questions, { ...good, a: 2 }, true)).toBe("invalid_answers");
    expect(answersProblem(questions, { ...good, a: 0.5 }, true)).toBe("invalid_answers");
    expect(answersProblem(questions, { ...good, b: [0, 1, 2] }, true)).toBe("invalid_answers");
    expect(answersProblem(questions, { ...good, b: [1, 1] }, true)).toBe("invalid_answers");
    expect(answersProblem(questions, { ...good, b: [] }, true)).toBe("invalid_answers");
    expect(answersProblem(questions, { ...good, c: 11 }, true)).toBe("invalid_answers");
    expect(answersProblem(questions, { ...good, d: "ja" }, true)).toBe("invalid_answers");
    expect(answersProblem(questions, { ...good, e: "x".repeat(21) }, true)).toBe("invalid_answers");
    expect(answersProblem(questions, { ...good, e: "   " }, true)).toBe("invalid_answers");
    expect(answersProblem(questions, { ...good, other: 1 }, true)).toBe("invalid_answers");
    expect(answersProblem(questions, [], true)).toBe("invalid_answers");
  });

  it("free text only when the survey allows it", () => {
    expect(answersProblem(questions, good, false)).toBe("invalid_answers");
    expect(answersProblem(questions, { a: 0, c: 0 }, false)).toBeNull();
  });

  it("free text is trimmed (spaces, tabs, line breaks only, like the database)", () => {
    expect(cleanAnswers(questions, good)).toEqual({ a: 1, b: [0, 2], c: 10, d: false, e: "Gut so" });
    expect(trimText(" x ")).toBe(" x ");
    expect(trimText(" \t\r\nx\n")).toBe("x");
  });
});

describe("survey images (Edge Function)", () => {
  const png = (w: number, h: number) => {
    const b = new Uint8Array(33);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(b.buffer).setUint32(16, w);
    new DataView(b.buffer).setUint32(20, h);
    return b;
  };
  const jpeg = (w: number, h: number) => {
    // SOI, an APP0 segment, then SOF0 with height and width.
    const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    return b;
  };
  const webpX = (w: number, h: number) => {
    const b = new Uint8Array(40);
    b.set([...new TextEncoder().encode("RIFF"), 0, 0, 0, 0, ...new TextEncoder().encode("WEBPVP8X")]);
    b.set([(w - 1) & 255, ((w - 1) >> 8) & 255, (w - 1) >> 16, (h - 1) & 255, ((h - 1) >> 8) & 255, (h - 1) >> 16], 24);
    return b;
  };
  const webpLossy = (w: number, h: number) => {
    const b = new Uint8Array(40);
    b.set([...new TextEncoder().encode("RIFF"), 0, 0, 0, 0, ...new TextEncoder().encode("WEBPVP8 ")]);
    b.set([0x9d, 0x01, 0x2a, w & 255, w >> 8, h & 255, h >> 8], 23);
    return b;
  };

  it("recognises PNG, JPEG and WebP by their bytes", () => {
    expect(checkSurveyImage(png(800, 600))).toEqual({ ok: true, info: { mime: "image/png", ext: "png", width: 800, height: 600 } });
    expect(checkSurveyImage(jpeg(1600, 900))).toMatchObject({ ok: true, info: { ext: "jpg", width: 1600, height: 900 } });
    expect(checkSurveyImage(webpX(1200, 1200))).toMatchObject({ ok: true, info: { ext: "webp", width: 1200, height: 1200 } });
    expect(checkSurveyImage(webpLossy(640, 480))).toMatchObject({ ok: true, info: { ext: "webp", width: 640, height: 480 } });
  });

  it("refuses SVG, other types, too big files and too many pixels", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(checkSurveyImage(svg)).toMatchObject({ ok: false, code: "invalid_type" });
    expect(checkSurveyImage(new TextEncoder().encode("GIF89a......"))).toMatchObject({ ok: false, code: "invalid_type" });
    expect(checkSurveyImage(new Uint8Array(0))).toMatchObject({ ok: false, code: "empty" });
    expect(checkSurveyImage(png(1601, 10))).toMatchObject({ ok: false, code: "too_many_pixels" });
    expect(checkSurveyImage(jpeg(10, 1601))).toMatchObject({ ok: false, code: "too_many_pixels" });
    const big = new Uint8Array(SURVEY_IMAGE_LIMITS.maxBytes + 1);
    big.set(png(10, 10));
    expect(checkSurveyImage(big)).toMatchObject({ ok: false, code: "too_large" });
  });

  it("base64 and alt text", () => {
    expect(decodeBase64(btoa("abc"))).toEqual(new Uint8Array([97, 98, 99]));
    expect(decodeBase64("not base64!")).toBeNull();
    expect(decodeBase64(42)).toBeNull();
    expect(cleanAltText("  Ein   Bild  ")).toBe("Ein Bild");
    expect(cleanAltText("   ")).toBeNull();
    expect(cleanAltText("x".repeat(141))).toBeNull();
  });
});
