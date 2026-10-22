import type { ReactNode } from "react";

import { useAuth } from "../lib/auth";
import { href, type Route } from "../lib/router";

type LayoutProps = { route: Route; children: ReactNode; theme: "light" | "dark"; onToggleTheme: () => void };

export function Layout({ route, children, theme, onToggleTheme }: LayoutProps) {
  const { state, signOut } = useAuth();
  const isAdmin = state.step === "ready" && state.role === "admin";
  const links: { route: Route; label: string; active: boolean }[] = [
    { route: { page: "overview" }, label: "Übersicht", active: route.page === "overview" },
    { route: { page: "queue" }, label: "Warteschlange", active: route.page === "queue" || route.page === "report" },
    { route: { page: "users" }, label: "Nutzer", active: route.page === "users" || route.page === "user" },
    ...(isAdmin
      ? [
          { route: { page: "usage" } as Route, label: "Nutzung", active: route.page === "usage" },
          { route: { page: "legal" } as Route, label: "Rechtstexte", active: route.page === "legal" || route.page === "legal-edit" },
          { route: { page: "pending" } as Route, label: "Offene Bestätigungen", active: route.page === "pending" },
          { route: { page: "audit" } as Route, label: "Audit-Log", active: route.page === "audit" },
        ]
      : []),
  ];

  return (
    <div className="layout">
      <header className="topbar">
        <strong className="brand">PeakPic Moderation</strong>
        <nav aria-label="Hauptnavigation">
          {links.map((link) => (
            <a key={link.label} href={href(link.route)} className={link.active ? "nav-link active" : "nav-link"} aria-current={link.active ? "page" : undefined}>
              {link.label}
            </a>
          ))}
        </nav>
        <div className="topbar-right">
          {state.step === "ready" && (
            <span className="muted">
              {state.email} · {state.role === "admin" ? "Admin" : "Moderator"}
            </span>
          )}
          <button type="button" className="button small" onClick={onToggleTheme} aria-label="Hell oder dunkel">
            {theme === "dark" ? "Hell" : "Dunkel"}
          </button>
          <button type="button" className="button small" onClick={signOut}>
            Abmelden
          </button>
        </div>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
