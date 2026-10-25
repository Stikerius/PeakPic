import { useState } from "react";

import { newQuestion, type DraftQuestion, type ScaleChoice } from "../../lib/surveyAdmin";
import { QUESTION_KIND_LABELS, SURVEY_LIMITS, type QuestionKind } from "../../lib/surveys";

const KINDS = Object.entries(QUESTION_KIND_LABELS) as [QuestionKind, string][];
const SCALES: [ScaleChoice, string][] = [
  ["1-5", "1 bis 5"],
  ["1-10", "1 bis 10"],
  ["0-10", "0 bis 10 (mit NPS)"],
];

type Props = {
  questions: DraftQuestion[];
  allowText: boolean;
  disabled: boolean;
  onChange: (questions: DraftQuestion[]) => void;
};

/**
 * The questions of a survey: type, required, text, answers, scale, free text length. Order by
 * dragging a question or with "↑"/"↓" (keyboard). At most 10 questions, 2 to 10 answers each.
 */
export function QuestionEditor({ questions, allowText, disabled, onChange }: Props) {
  const [dragging, setDragging] = useState<number | null>(null);
  const update = (index: number, change: Partial<DraftQuestion>) => onChange(questions.map((q, i) => (i === index ? { ...q, ...change } : q)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= questions.length || from === to) return;
    const next = [...questions];
    const [item] = next.splice(from, 1);
    if (item !== undefined) next.splice(to, 0, item);
    onChange(next);
  };

  return (
    <div className="question-list">
      {questions.map((q, i) => (
        <fieldset
          key={q.key}
          className={dragging === i ? "panel question dragging" : "panel question"}
          disabled={disabled}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (dragging !== null) move(dragging, i);
            setDragging(null);
          }}
          onDragEnd={() => setDragging(null)}
        >
          <legend>
            <span
              className="drag-handle"
              aria-hidden="true"
              draggable={!disabled}
              title="Ziehen zum Verschieben"
              onDragStart={(e) => {
                setDragging(i);
                e.dataTransfer.effectAllowed = "move";
              }}
            >
              ⋮⋮
            </span>{" "}
            Frage {i + 1}
          </legend>
          <div className="filters">
            <label>
              Fragetyp
              <select
                value={q.kind}
                onChange={(e) => {
                  const kind = e.target.value as QuestionKind;
                  update(i, { kind, options: kind === "single" || kind === "multiple" ? (q.options.length >= 2 ? q.options : ["", ""]) : q.options });
                }}
              >
                {KINDS.map(([value, label]) => (
                  <option key={value} value={value} disabled={value === "text" && !allowText}>
                    {label}
                    {value === "text" && !allowText ? " (erst erlauben)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="choice">
              <input type="checkbox" checked={q.required} onChange={(e) => update(i, { required: e.target.checked })} />
              Pflichtfrage
            </label>
            <div className="action-row">
              <button type="button" className="button small" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Frage ${i + 1} nach oben`}>
                ↑
              </button>
              <button type="button" className="button small" onClick={() => move(i, i + 1)} disabled={i === questions.length - 1} aria-label={`Frage ${i + 1} nach unten`}>
                ↓
              </button>
              <button type="button" className="button small danger" onClick={() => onChange(questions.filter((_, j) => j !== i))}>
                Entfernen
              </button>
            </div>
          </div>
          <label className="field">
            <span>
              Frage ({[...q.prompt.trim()].length} von {SURVEY_LIMITS.prompt[1]} Zeichen)
            </span>
            <input value={q.prompt} maxLength={SURVEY_LIMITS.prompt[1]} onChange={(e) => update(i, { prompt: e.target.value })} />
          </label>

          {(q.kind === "single" || q.kind === "multiple") && (
            <div className="options-editor">
              {q.options.map((o, j) => (
                <div key={j} className="option-row">
                  <label className="field grow">
                    <span>Antwort {j + 1}</span>
                    <input value={o} maxLength={SURVEY_LIMITS.optionText[1]} onChange={(e) => update(i, { options: q.options.map((x, k) => (k === j ? e.target.value : x)) })} />
                  </label>
                  <button
                    type="button"
                    className="button small"
                    disabled={q.options.length <= SURVEY_LIMITS.options[0]}
                    onClick={() => update(i, { options: q.options.filter((_, k) => k !== j), maxChoices: Math.min(q.maxChoices, q.options.length - 1) })}
                    aria-label={`Antwort ${j + 1} entfernen`}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button type="button" className="button small" disabled={q.options.length >= SURVEY_LIMITS.options[1]} onClick={() => update(i, { options: [...q.options, ""] })}>
                Antwort hinzufügen
              </button>
              {q.kind === "multiple" && (
                <label className="field">
                  <span>Höchstens ankreuzbar</span>
                  <input
                    type="number"
                    min={1}
                    max={q.options.length}
                    value={q.maxChoices}
                    onChange={(e) => update(i, { maxChoices: Math.max(1, Math.min(q.options.length, Math.round(Number(e.target.value) || 1))) })}
                  />
                </label>
              )}
            </div>
          )}
          {q.kind === "scale" && (
            <label className="field">
              <span>Skala</span>
              <select value={q.scale} onChange={(e) => update(i, { scale: e.target.value as ScaleChoice })}>
                {SCALES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {q.kind === "text" && (
            <label className="field">
              <span>Höchstlänge der Antwort (20 bis 280 Zeichen)</span>
              <input type="number" min={20} max={280} value={q.textMax} onChange={(e) => update(i, { textMax: Math.max(20, Math.min(280, Math.round(Number(e.target.value) || 280))) })} />
            </label>
          )}
        </fieldset>
      ))}
      <button type="button" className="button" disabled={disabled || questions.length >= SURVEY_LIMITS.questions} onClick={() => onChange([...questions, newQuestion("single")])}>
        Frage hinzufügen ({questions.length} von {SURVEY_LIMITS.questions})
      </button>
    </div>
  );
}
