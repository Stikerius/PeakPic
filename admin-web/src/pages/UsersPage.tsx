import { useState, type FormEvent } from "react";

import { searchUsers, type UserRow } from "../lib/api";
import { ACCOUNT_STATUS_LABELS, formatDateTime, label } from "../lib/format";
import { navigate } from "../lib/router";
import { EmptyState, PageHeader } from "../components/ui";

export function UsersPage() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function search(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    if (q.length < 2) {
      setError("Mindestens 2 Zeichen.");
      return;
    }
    setError(null);
    searchUsers(q)
      .then(setRows)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Fehler"));
  }

  return (
    <>
      <PageHeader title="Nutzer">Konten suchen und ihren Verlauf öffnen.</PageHeader>
      <form className="filters" onSubmit={search}>
        <label className="grow">
          Username, Anzeigename oder ID
          <input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100} autoFocus />
        </label>
        <button type="submit" className="button primary">Suchen</button>
      </form>
      {error !== null && <p className="error">{error}</p>}
      {rows !== null && rows.length === 0 && <EmptyState title="Keine Treffer">Anderen Namen oder die vollständige ID versuchen.</EmptyState>}
      {rows !== null && rows.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Anzeigename</th>
              <th>Status</th>
              <th>Konto seit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                tabIndex={0}
                onClick={() => navigate({ page: "user", id: row.id })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") navigate({ page: "user", id: row.id });
                }}
              >
                <td>@{row.username}</td>
                <td>{row.displayName}</td>
                <td>{label(ACCOUNT_STATUS_LABELS, row.accountStatus)}</td>
                <td>{formatDateTime(row.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
