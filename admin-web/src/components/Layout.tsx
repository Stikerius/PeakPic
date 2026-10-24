import { useEffect, useState, type ReactNode } from "react";

import { AmbientBackground } from "./ambient/AmbientBackground";
import { BrandLogo } from "./BrandLogo";
import { CommandPalette } from "./CommandPalette";
import { Icon } from "./Icon";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { useAppearance } from "../lib/appearanceContext";
import { useAuth } from "../lib/auth";
import { useDashboardBrand } from "../lib/dashboardBrand";
import { NAV_GROUPS, activeItem, isTypingTarget, navFor } from "../lib/navigation";
import { href, type Route } from "../lib/router";

const COLLAPSED_KEY = "peakpic-admin-sidebar";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "collapsed";
  } catch {
    return false;
  }
}

type LayoutProps = { route: Route; children: ReactNode };

/**
 * Sidebar (areas with icons, collapsible to icons), header with area and page, command palette
 * (Strg+K) and the list of shortcuts (?). The style ("Neu" or "Klassisch") only changes tokens and a
 * few layout rules (styles.css); the markup is the same.
 */
export function Layout({ route, children }: LayoutProps) {
  const { state, signOut } = useAuth();
  const { appearance, mode, update } = useAppearance();
  const brand = useDashboardBrand();
  const isAdmin = state.step === "ready" && state.role === "admin";
  const items = navFor(isAdmin);
  const current = activeItem(route);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  function toggleSidebar() {
    setCollapsed((value) => {
      try {
        window.localStorage.setItem(COLLAPSED_KEY, value ? "open" : "collapsed");
      } catch {
        // Only a convenience: without storage the choice lasts until reload.
      }
      return !value;
    });
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target as HTMLElement | null)) return;
      if (document.querySelector("dialog[open]") !== null) return;
      if (event.key === "?") {
        event.preventDefault();
        setHelpOpen(true);
      } else if (event.key === "[" && appearance.style === "new") {
        event.preventDefault();
        toggleSidebar();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [appearance.style]);

  return (
    <div className={collapsed ? "layout collapsed" : "layout"}>
      <AmbientBackground route={route} />
      <a className="skip-link" href="#main">
        Zum Inhalt springen
      </a>
      <aside className="sidebar">
        <div className="sidebar-head">
          <a className="brand" href={href({ page: "overview" })} aria-label="PeakPic Moderation, Übersicht">
            <BrandLogo spec={brand.spec} params={brand.params} palette={brand.palette} mode={brand.mode} size={28} dots={false} className="brand-logo" />
            <span className="brand-name">PeakPic</span>
          </a>
          <button
            type="button"
            className="icon-button collapse-toggle"
            onClick={toggleSidebar}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Seitenleiste ausklappen" : "Seitenleiste einklappen"}
            title="Seitenleiste ein- oder ausklappen ([)"
          >
            <Icon name={collapsed ? "expand" : "collapse"} />
          </button>
        </div>
        <nav aria-label="Hauptnavigation" className="nav">
          {NAV_GROUPS.map((group) => {
            const inGroup = items.filter((item) => item.group === group);
            if (inGroup.length === 0) return null;
            return (
              <div key={group} className="nav-group">
                <p className="nav-group-title">{group}</p>
                {inGroup.map((item) => {
                  const active = item === current;
                  return (
                    <a
                      key={item.label}
                      href={href(item.route)}
                      className={active ? "nav-link active" : "nav-link"}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? item.label : undefined}
                    >
                      <Icon name={item.icon} />
                      <span className="nav-label">{item.label}</span>
                    </a>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="main">
        <header className="pagebar">
          <p className="crumbs">
            {current !== undefined && (
              <>
                <span className="muted">{current.group}</span>
                <span className="muted" aria-hidden="true">
                  {" "}
                  ›{" "}
                </span>
                <span>{current.label}</span>
              </>
            )}
          </p>
          <div className="pagebar-actions">
            <button type="button" className="command-button" onClick={() => setPaletteOpen(true)} aria-label="Befehlspalette öffnen (Strg+K)">
              <Icon name="search" />
              <span className="command-label">Suchen …</span>
              <kbd>Strg K</kbd>
            </button>
            <button type="button" className="icon-button" onClick={() => setHelpOpen(true)} aria-label="Tastaturkürzel anzeigen (?)" title="Tastaturkürzel (?)">
              <Icon name="keyboard" />
            </button>
            <button type="button" className="button small" onClick={() => update({ mode: mode === "dark" ? "light" : "dark" })}>
              {mode === "dark" ? "Hell" : "Dunkel"}
            </button>
            {state.step === "ready" && (
              <span className="muted user-label">
                {state.email} · {state.role === "admin" ? "Admin" : "Moderator"}
              </span>
            )}
            <button type="button" className="button small" onClick={signOut}>
              Abmelden
            </button>
          </div>
        </header>
        <main id="main" className="content" tabIndex={-1}>
          {children}
        </main>
      </div>

      <CommandPalette open={paletteOpen} items={items} onClose={() => setPaletteOpen(false)} />
      <ShortcutsDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
