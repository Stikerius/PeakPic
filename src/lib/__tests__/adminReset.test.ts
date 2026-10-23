import { describe, expect, it } from "@jest/globals";

import {
  blockerFor,
  categoryListText,
  countsTotal,
  MAX_TARGETS,
  nextStep,
  phraseMatches,
  previousStep,
  pruneSelection,
  renderMessage,
  runActions,
  selectAllExceptProtected,
  selectability,
  stepForJob,
  sumCounts,
  toCounts,
  toggleSelection,
  unknownPlaceholders,
  type Candidate,
  type WizardInput,
} from "../../../admin-web/src/lib/reset";

function person(id: string, extra: Partial<Candidate> = {}): Candidate {
  return {
    userId: id,
    username: `user_${id}`,
    displayName: id,
    accountStatus: "active",
    createdAt: "2026-10-01T00:00:00Z",
    protection: null,
    flags: [],
    ...extra,
  };
}

const normal = person("a");
const other = person("b");
const flagged = person("f", { flags: ["open_reports"] });
const protectedOne = person("p", { protection: "protected" });
const staff = person("s", { protection: "staff" });
const self = person("me", { protection: "self" });
const deleting = person("d", { accountStatus: "deleting", flags: ["deleting"] });

describe("selection", () => {
  it("never selects protected accounts, staff or the own account", () => {
    for (const c of [protectedOne, staff, self]) {
      expect(selectability(c, "categories", true).kind).toBe("locked");
      expect(toggleSelection(new Set(), c, "full", true).has(c.userId)).toBe(false);
    }
  });

  it("needs the extra confirmation for flagged accounts", () => {
    expect(selectability(flagged, "categories", false).kind).toBe("needs-flag-confirmation");
    expect(toggleSelection(new Set(), flagged, "categories", false).size).toBe(0);
    expect(toggleSelection(new Set(), flagged, "categories", true).has("f")).toBe(true);
  });

  it("allows accounts being deleted only for full deletion", () => {
    expect(selectability(deleting, "categories", true).kind).toBe("locked");
    expect(selectability(deleting, "full", true).kind).toBe("selectable");
  });

  it("toggles off again", () => {
    const on = toggleSelection(new Set(), normal, "categories", false);
    expect(toggleSelection(on, normal, "categories", false).size).toBe(0);
  });

  it("selects all except protected (flagged only after confirmation)", () => {
    const list = [normal, other, flagged, protectedOne, staff, self];
    expect([...selectAllExceptProtected(new Set(), list, "categories", false)].sort()).toEqual(["a", "b"]);
    expect([...selectAllExceptProtected(new Set(), list, "categories", true)].sort()).toEqual(["a", "b", "f"]);
  });

  it("stops at the maximum", () => {
    const many = Array.from({ length: MAX_TARGETS + 20 }, (_, i) => person(`x${i}`));
    expect(selectAllExceptProtected(new Set(), many, "full", false).size).toBe(MAX_TARGETS);
  });

  it("drops people that are no longer selectable", () => {
    const known = new Map([normal, flagged, deleting].map((c) => [c.userId, c]));
    const selected = new Set(["a", "f", "d"]);
    expect([...pruneSelection(selected, known, "full", true)].sort()).toEqual(["a", "d", "f"]);
    expect([...pruneSelection(selected, known, "categories", false)]).toEqual(["a"]);
  });
});

describe("confirmation word", () => {
  it("must match exactly", () => {
    expect(phraseMatches("NEUSTART")).toBe(true);
    expect(phraseMatches("neustart")).toBe(false);
    expect(phraseMatches(" NEUSTART")).toBe(false);
    expect(phraseMatches("NEUSTART ")).toBe(false);
    expect(phraseMatches("")).toBe(false);
  });
});

describe("mail text", () => {
  it("lists categories in a fixed order", () => {
    expect(categoryListText(["stories", "posts", "chats"])).toBe("Chats, Beiträge und Storys");
    expect(categoryListText(["posts"])).toBe("Beiträge");
    expect(categoryListText([])).toBe("");
  });

  it("fills the placeholders", () => {
    const text = renderMessage("Gelöscht: {{kategorien}}. Grund: {{begruendung}} ({{kategorien}})", {
      categories: ["posts", "stories"],
      reason: "  Testphase beendet ",
      mode: "categories",
    });
    expect(text).toBe("Gelöscht: Beiträge und Storys. Grund: Testphase beendet (Beiträge und Storys)");
    expect(renderMessage("{{kategorien}}", { categories: [], reason: "x", mode: "full" })).toBe("dein Konto mit allen Daten");
  });

  it("finds unknown placeholders", () => {
    expect(unknownPlaceholders("{{kategorie}} {{begruendung}} {{kategorien}}")).toEqual(["{{kategorie}}"]);
  });
});

describe("numbers", () => {
  it("reads and adds counts", () => {
    const a = toCounts({ posts: { posts: 2, likes: "3" }, chats: { messages: 1 }, junk: 5 });
    const b = toCounts({ posts: { posts: 1 } });
    expect(countsTotal(a)).toBe(6);
    expect(sumCounts([a, b])).toEqual({ posts: { posts: 3, likes: 3 }, chats: { messages: 1 } });
    expect(toCounts(null)).toEqual({});
  });
});

describe("wizard", () => {
  const ready: WizardInput = {
    mode: "categories",
    categories: ["posts"],
    allowFull: true,
    selectedCount: 2,
    previewFresh: true,
    reason: "Testphase beendet",
    subject: "Betreff",
    message: "Text {{kategorien}}",
    backupConfirmed: true,
    phrase: "NEUSTART",
    totpCode: "123456",
  };

  it("lets every step through with complete input", () => {
    for (const step of ["scope", "users", "preview", "message", "confirm"] as const) {
      expect(blockerFor(step, ready)).toBeNull();
    }
  });

  it("blocks each step for its own reason", () => {
    expect(blockerFor("scope", { ...ready, mode: null })).not.toBeNull();
    expect(blockerFor("scope", { ...ready, categories: [] })).not.toBeNull();
    expect(blockerFor("scope", { ...ready, mode: "full", allowFull: false })).not.toBeNull();
    expect(blockerFor("scope", { ...ready, mode: "full", categories: [] })).toBeNull();
    expect(blockerFor("users", { ...ready, selectedCount: 0 })).not.toBeNull();
    expect(blockerFor("users", { ...ready, selectedCount: MAX_TARGETS + 1 })).not.toBeNull();
    expect(blockerFor("preview", { ...ready, previewFresh: false })).not.toBeNull();
    expect(blockerFor("message", { ...ready, reason: "zu kurz" })).not.toBeNull();
    expect(blockerFor("message", { ...ready, subject: "zwei\nZeilen" })).not.toBeNull();
    expect(blockerFor("message", { ...ready, message: "{{kategorie}}" })).not.toBeNull();
    expect(blockerFor("confirm", { ...ready, backupConfirmed: false })).not.toBeNull();
    expect(blockerFor("confirm", { ...ready, phrase: "neustart" })).not.toBeNull();
    expect(blockerFor("confirm", { ...ready, totpCode: "12345" })).not.toBeNull();
  });

  it("moves forward and back only while the job is a draft", () => {
    expect(nextStep("scope")).toBe("users");
    expect(nextStep("message")).toBe("confirm");
    expect(nextStep("confirm")).toBeNull();
    expect(previousStep("users", null)).toBe("scope");
    expect(previousStep("confirm", "draft")).toBe("message");
    expect(previousStep("scope", "draft")).toBeNull();
    expect(previousStep("confirm", "confirmed")).toBeNull();
    expect(previousStep("run", "running")).toBeNull();
  });

  it("opens existing jobs at the right step", () => {
    expect(stepForJob("draft", false)).toBe("users");
    expect(stepForJob("draft", true)).toBe("preview");
    expect(stepForJob("confirmed", true)).toBe("run");
    expect(stepForJob("failed", true)).toBe("run");
    expect(stepForJob("done", true)).toBe("result");
    expect(stepForJob("cancelled", false)).toBe("result");
  });

  it("allows cancelling only before the start and resuming only after it", () => {
    expect(runActions("confirmed")).toEqual({ start: true, resume: false, cancel: true });
    expect(runActions("running")).toEqual({ start: false, resume: true, cancel: false });
    expect(runActions("failed")).toEqual({ start: false, resume: true, cancel: false });
    expect(runActions("done")).toEqual({ start: false, resume: false, cancel: false });
  });
});
