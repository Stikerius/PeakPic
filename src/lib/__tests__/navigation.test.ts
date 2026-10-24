import { describe, expect, it } from "@jest/globals";

import { NAV_ITEMS, activeItem, filterCommands, isTypingTarget, navFor, pageTitle } from "../../../admin-web/src/lib/navigation";

describe("navigation", () => {
  it("moderators see only the moderation pages", () => {
    expect(navFor(false).map((i) => i.label)).toEqual(["Übersicht", "Warteschlange", "Nutzer"]);
    expect(navFor(true)).toHaveLength(NAV_ITEMS.length);
    expect(navFor(true).map((i) => i.label)).toEqual(expect.arrayContaining(["Logos", "Design", "Mitteilungen"]));
  });

  it("detail pages belong to their entry", () => {
    expect(activeItem({ page: "report", id: "x" })?.label).toBe("Warteschlange");
    expect(activeItem({ page: "mail-campaign", id: "x" })?.label).toBe("Mitteilungen");
    expect(activeItem({ page: "design" })?.group).toBe("Gestaltung");
  });

  it("the command palette finds pages by label, area and keywords, without umlauts too", () => {
    expect(filterCommands(NAV_ITEMS, "").length).toBe(NAV_ITEMS.length);
    expect(filterCommands(NAV_ITEMS, "warte").map((i) => i.label)).toEqual(["Warteschlange"]);
    expect(filterCommands(NAV_ITEMS, "ubersicht").map((i) => i.label)).toEqual(["Übersicht"]);
    expect(filterCommands(NAV_ITEMS, "hell dunkel").map((i) => i.label)).toEqual(["Design"]);
    expect(filterCommands(NAV_ITEMS, "gestaltung").map((i) => i.label)).toEqual(["Logos", "Design"]);
    expect(filterCommands(navFor(false), "logos")).toEqual([]);
  });

  it("the window title names the page", () => {
    expect(pageTitle({ page: "queue" })).toBe("Warteschlange · PeakPic Moderation");
    expect(pageTitle({ page: "user", id: "x" })).toBe("Nutzer · PeakPic Moderation");
  });

  it("shortcuts stay quiet while typing", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "textarea" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
