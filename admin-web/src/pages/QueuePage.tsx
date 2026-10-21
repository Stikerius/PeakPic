import { useCallback, useEffect, useRef, useState } from "react";

import { fetchQueue, type QueueFilter, type QueueRow } from "../lib/api";
import { REASON_LABELS, STATUS_LABELS, TYPE_LABELS, formatAge, formatDateTime, label } from "../lib/format";
import { navigate } from "../lib/router";

const PAGE = 50;

/** Report queue with filters. Keyboard: j/k or arrows to move, Enter to open, r to reload. */
export function QueuePage() {
  const [filter, setFilter] = useState<QueueFilter>({
    status: "open",
    targetType: null,
    reason: null,
    minAgeHours: null,
    newestFirst: false,
  });
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const tableRef = useRef<HTMLTableSectionElement>(null);

  const load = useCallback(() => {
    fetchQueue(filter, offset)
      .then((result) => {
        setError(null);
        setRows(result);
        setSelected(0);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Fehler"));
  }, [filter, offset]);

  useEffect(load, [load]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
      if (rows === null || rows.length === 0) return;
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        setSelected((i) => Math.min(rows.length - 1, i + 1));
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        setSelected((i) => Math.max(0, i - 1));
      } else if (event.key === "Enter") {
        const row = rows[selected];
        if (row !== undefined) navigate({ page: "report", id: row.id });
      } else if (event.key === "r") {
        load();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, selected, load]);

  useEffect(() => {
    tableRef.current?.querySelector<HTMLTableRowElement>(`tr[data-index="${selected}"]`)?.focus();
  }, [selected, rows]);

  function update(change: Partial<QueueFilter>) {
    setOffset(0);
    setFilter((current) => ({ ...current, ...change }));
  }

  return (
    <>
      <h1>Warteschlange</h1>
      <div className="filters" role="group" aria-label="Filter">
        <label>
          Status
          <select value={filter.status ?? ""} onChange={(e) => update({ status: e.target.value === "" ? null : e.target.value })}>
            <option value="">Alle</option>
            {Object.entries(STATUS_LABELS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </label>
        <label>
          Typ
          <select value={filter.targetType ?? ""} onChange={(e) => update({ targetType: e.target.value === "" ? null : e.target.value })}>
            <option value="">Alle</option>
            {Object.entries(TYPE_LABELS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </label>
        <label>
          Grund
          <select value={filter.reason ?? ""} onChange={(e) => update({ reason: e.target.value === "" ? null : e.target.value })}>
            <option value="">Alle</option>
            {Object.entries(REASON_LABELS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </label>
        <label>
          Älter als
          <select
            value={filter.minAgeHours ?? ""}
            onChange={(e) => update({ minAgeHours: e.target.value === "" ? null : Number(e.target.value) })}
          >
            <option value="">beliebig</option>
            <option value="24">1 Tag</option>
            <option value="72">3 Tage</option>
            <option value="168">7 Tage</option>
          </select>
        </label>
        <label>
          Sortierung
          <select value={filter.newestFirst ? "new" : "old"} onChange={(e) => update({ newestFirst: e.target.value === "new" })}>
            <option value="old">Älteste zuerst</option>
            <option value="new">Neueste zuerst</option>
          </select>
        </label>
        <button type="button" className="button small" onClick={load}>Neu laden (r)</button>
      </div>
      {error !== null && <p className="error">{error}</p>}
      {rows !== null && rows.length === 0 && <p className="muted">Keine Meldungen für diese Filter.</p>}
      {rows !== null && rows.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Eingang</th>
              <th>Typ</th>
              <th>Grund</th>
              <th>Betroffen</th>
              <th>Gemeldet von</th>
              <th>Meldungen zum Ziel</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody ref={tableRef}>
            {rows.map((row, index) => (
              <tr
                key={row.id}
                data-index={index}
                tabIndex={0}
                className={index === selected ? "selected" : undefined}
                onClick={() => navigate({ page: "report", id: row.id })}
                onFocus={() => setSelected(index)}
              >
                <td title={formatDateTime(row.createdAt)}>{formatAge(row.createdAt)}</td>
                <td>{label(TYPE_LABELS, row.targetType)}</td>
                <td>{label(REASON_LABELS, row.reason)}</td>
                <td>{row.targetUsername !== null ? `@${row.targetUsername}` : "–"}</td>
                <td>{row.reporterUsername !== null ? `@${row.reporterUsername}` : "gelöscht"}</td>
                <td className="numeric">{row.reportsOnTarget}</td>
                <td>{label(STATUS_LABELS, row.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="pager">
        <button type="button" className="button small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Zurück</button>
        <button type="button" className="button small" disabled={rows === null || rows.length < PAGE} onClick={() => setOffset(offset + PAGE)}>Weiter</button>
      </div>
    </>
  );
}
