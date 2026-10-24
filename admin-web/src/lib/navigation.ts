// Pure: the pages of the dashboard for the sidebar, the header and the command palette (unit
// tested in src/lib/__tests__/navigation.test.ts).

import type { Route } from "./router";

export type IconName =
  | "overview"
  | "queue"
  | "users"
  | "usage"
  | "legal"
  | "pending"
  | "reset"
  | "mail"
  | "audit"
  | "logos"
  | "design";

export type NavGroup = "Moderation" | "Verwaltung" | "Gestaltung";

export type NavItem = {
  route: Route;
  label: string;
  group: NavGroup;
  icon: IconName;
  adminOnly: boolean;
  /** Pages that belong to this entry (details, editors). */
  pages: readonly Route["page"][];
  /** More words the command palette finds it by. */
  keywords: string;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { route: { page: "overview" }, label: "Übersicht", group: "Moderation", icon: "overview", adminOnly: false, pages: ["overview"], keywords: "start dashboard zahlen" },
  { route: { page: "queue" }, label: "Warteschlange", group: "Moderation", icon: "queue", adminOnly: false, pages: ["queue", "report"], keywords: "meldungen reports offen" },
  { route: { page: "users" }, label: "Nutzer", group: "Moderation", icon: "users", adminOnly: false, pages: ["users", "user"], keywords: "konten suche profil" },
  { route: { page: "usage" }, label: "Nutzung", group: "Verwaltung", icon: "usage", adminOnly: true, pages: ["usage"], keywords: "statistik zahlen" },
  { route: { page: "legal" }, label: "Rechtstexte", group: "Verwaltung", icon: "legal", adminOnly: true, pages: ["legal", "legal-edit"], keywords: "agb datenschutz richtlinien" },
  { route: { page: "pending" }, label: "Offene Bestätigungen", group: "Verwaltung", icon: "pending", adminOnly: true, pages: ["pending"], keywords: "rechtstexte erinnerung" },
  { route: { page: "reset" }, label: "Bereinigung", group: "Verwaltung", icon: "reset", adminOnly: true, pages: ["reset", "reset-job"], keywords: "neustart löschen daten" },
  { route: { page: "mail" }, label: "Mitteilungen", group: "Verwaltung", icon: "mail", adminOnly: true, pages: ["mail", "mail-campaign"], keywords: "e-mail mail senden" },
  { route: { page: "audit" }, label: "Audit-Log", group: "Verwaltung", icon: "audit", adminOnly: true, pages: ["audit"], keywords: "protokoll aktionen" },
  { route: { page: "logos" }, label: "Logos", group: "Gestaltung", icon: "logos", adminOnly: true, pages: ["logos"], keywords: "bibliothek svg animation" },
  { route: { page: "design" }, label: "Design", group: "Gestaltung", icon: "design", adminOnly: true, pages: ["design"], keywords: "farbe stil modus hell dunkel" },
];

export const NAV_GROUPS: readonly NavGroup[] = ["Moderation", "Verwaltung", "Gestaltung"];

export function navFor(isAdmin: boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => isAdmin || !item.adminOnly);
}

export function activeItem(route: Route): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.pages.includes(route.page));
}

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
}

/** Entries matching every word of the query (label, area, keywords), in navigation order. */
export function filterCommands(items: readonly NavItem[], query: string): NavItem[] {
  const words = normalize(query).split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return [...items];
  return items.filter((item) => {
    const haystack = normalize(`${item.label} ${item.group} ${item.keywords}`);
    return words.every((w) => haystack.includes(w));
  });
}

/** Keyboard shortcuts stay quiet while someone types. */
export function isTypingTarget(target: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (target === null) return false;
  const tag = (target.tagName ?? "").toLowerCase();
  return target.isContentEditable === true || tag === "input" || tag === "textarea" || tag === "select";
}

export const SHORTCUTS: readonly { keys: string; text: string; where: string }[] = [
  { keys: "Strg+K oder ⌘K", text: "Befehlspalette: Seiten und Nutzer suchen", where: "Überall" },
  { keys: "?", text: "Diese Liste öffnen", where: "Überall" },
  { keys: "[", text: "Seitenleiste ein- oder ausklappen", where: "Überall (Stil Neu)" },
  { keys: "j / ↓", text: "Nächste Meldung", where: "Warteschlange" },
  { keys: "k / ↑", text: "Vorherige Meldung", where: "Warteschlange" },
  { keys: "Enter", text: "Meldung öffnen", where: "Warteschlange" },
  { keys: "r", text: "Neu laden", where: "Warteschlange" },
  { keys: "Esc", text: "Dialog schliessen", where: "Dialoge" },
];
