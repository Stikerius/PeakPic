import { useEffect, useId, useRef, useState } from "react";

import { Icon } from "./Icon";
import { searchUsers, type UserRow } from "../lib/api";
import { filterCommands, type NavItem } from "../lib/navigation";
import { navigate, type Route } from "../lib/router";

type Result = { key: string; label: string; detail: string; route: Route };

/**
 * Strg+K: jump to a page or find a person (username, display name or id). Combobox with a
 * listbox; arrows choose, Enter opens, Escape closes.
 */
export function CommandPalette({ open, items, onClose }: { open: boolean; items: readonly NavItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [users, setUsers] = useState<{ query: string; rows: UserRow[] }>({ query: "", rows: [] });
  const listId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // People: from 2 characters, a moment after typing stops.
  const term = query.trim();
  useEffect(() => {
    if (!open || term.length < 2) return;
    const timer = window.setTimeout(() => {
      searchUsers(term)
        .then((rows) => setUsers({ query: term, rows: rows.slice(0, 8) }))
        .catch(() => setUsers({ query: term, rows: [] }));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [open, term]);

  const pages: Result[] = filterCommands(items, query).map((item) => ({
    key: `page-${item.label}`,
    label: item.label,
    detail: item.group,
    route: item.route,
  }));
  const people: Result[] =
    term.length >= 2 && users.query === term
      ? users.rows.map((u) => ({ key: `user-${u.id}`, label: `@${u.username}`, detail: u.displayName, route: { page: "user", id: u.id } }))
      : [];
  const results = [...pages, ...people];
  const current = Math.min(active, Math.max(results.length - 1, 0));

  function close() {
    setQuery("");
    setActive(0);
    onClose();
  }

  function go(result: Result | undefined) {
    if (result === undefined) return;
    navigate(result.route);
    close();
  }

  return (
    <dialog
      ref={ref}
      className="dialog command-palette"
      aria-label="Befehlspalette"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="command-input">
        <Icon name="search" />
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={results.length > 0 ? `${listId}-${current}` : undefined}
          aria-label="Seite oder Nutzer suchen"
          placeholder="Seite oder Nutzer suchen …"
          value={query}
          autoFocus
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((current + 1) % Math.max(results.length, 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((current - 1 + results.length) % Math.max(results.length, 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(results[current]);
            }
          }}
        />
      </div>
      <ul id={listId} role="listbox" className="command-list" aria-label="Treffer">
        {results.map((result, i) => (
          <li
            key={result.key}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === current}
            className={i === current ? "command-item active" : "command-item"}
            onMouseEnter={() => setActive(i)}
            onClick={() => go(result)}
          >
            <span>{result.label}</span>
            <span className="muted">{result.detail}</span>
          </li>
        ))}
        {results.length === 0 && <li className="command-empty muted">Keine Treffer.</li>}
      </ul>
      <p className="command-hint muted">
        <kbd>↑</kbd> <kbd>↓</kbd> wählen · <kbd>Enter</kbd> öffnen · <kbd>Esc</kbd> schliessen
        {term.length < 2 && " · Nutzer ab 2 Zeichen"}
      </p>
    </dialog>
  );
}
