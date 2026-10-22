import { asArray, asRecord, bool, str, strOrNull, type Json } from "../lib/decode";
import { formatDateTime } from "../lib/format";
import { SignedImage } from "./SignedImage";

const STATE_LABELS: Record<string, string> = { removed: "Entfernt", quarantined: "Quarantäne" };

/** The reported content. All text is rendered as plain text (React escapes it). */
export function ContentPreview({ type, content }: { type: string; content: Json }) {
  const state = strOrNull(content.moderation_state);
  return (
    <section className="panel" aria-label="Gemeldeter Inhalt">
      <h3>
        Inhalt {state !== null && <span className="pill warn">{STATE_LABELS[state] ?? state}</span>}
      </h3>
      {state !== null && strOrNull(content.removed_reason) !== null && (
        <p className="muted">Begründung der Entfernung: {str(content.removed_reason)}</p>
      )}
      {type === "post" && (
        <>
          <div className="images">
            {asArray(content.photos).map((path, index) => (
              <SignedImage key={`${str(path)}-${index}`} path={str(path)} alt={`Foto ${index + 1} des Beitrags`} />
            ))}
          </div>
          <p className="user-text">{str(content.caption) || <span className="muted">Keine Bildunterschrift</span>}</p>
          <p className="muted">
            Trainingstag {str(content.workout_date)} · erstellt {formatDateTime(strOrNull(content.created_at))}
            {bool(content.in_feed) ? "" : " · nur Streak-Nachweis"}
          </p>
        </>
      )}
      {type === "story" && (
        <>
          <div className="images">
            <SignedImage path={str(content.photo_path)} alt="Story" />
          </div>
          {str(content.overlay_text) !== "" && <p className="user-text">{str(content.overlay_text)}</p>}
          <p className="muted">Erstellt {formatDateTime(strOrNull(content.created_at))}</p>
        </>
      )}
      {type === "comment" && (
        <>
          <p className="user-text">{str(content.body)}</p>
          <p className="muted">Erstellt {formatDateTime(strOrNull(content.created_at))}</p>
        </>
      )}
      {type === "profile" && (
        <>
          {strOrNull(content.avatar_path) !== null && (
            <div className="images">
              <SignedImage path={str(content.avatar_path)} alt="Profilbild" />
            </div>
          )}
          <p className="user-text">
            {str(content.display_name)} (@{str(content.username)})
          </p>
          <p className="muted">Konto seit {formatDateTime(strOrNull(content.created_at))}</p>
        </>
      )}
      {type === "plan" && (
        <>
          <p className="user-text">
            <strong>{str(content.name)}</strong>
          </p>
          <ol className="plan-days">
            {asArray(content.days).map((value, index) => {
              const day = asRecord(value);
              return (
                <li key={index}>
                  <span className="user-text">
                    {str(day.type) === "rest" ? `Ruhetag: ${str(day.title)}` : str(day.title)}
                  </span>
                  {strOrNull(day.notes) !== null && <p className="muted user-text">{str(day.notes)}</p>}
                  <ul>
                    {asArray(day.exercises).map((exValue, exIndex) => {
                      const ex = asRecord(exValue);
                      return (
                        <li key={exIndex} className="user-text">
                          {str(ex.name)} · {String(ex.sets ?? "")} Sätze
                          {strOrNull(ex.notes) !== null ? ` · ${str(ex.notes)}` : ""}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ol>
          <p className="muted">Erstellt {formatDateTime(strOrNull(content.created_at))}</p>
        </>
      )}
      {type === "workout" && (
        <>
          <p className="user-text">
            <strong>{strOrNull(content.title) ?? strOrNull(content.plan_day_title) ?? "Freies Training"}</strong>
          </p>
          {strOrNull(content.note) !== null && <p className="user-text">{str(content.note)}</p>}
          <ul>
            {asArray(content.exercises).map((value, index) => {
              const ex = asRecord(value);
              return (
                <li key={index} className="user-text">
                  {str(ex.name)} · {String(ex.sets ?? "")} Sätze
                </li>
              );
            })}
          </ul>
          <p className="muted">
            Trainingstag {str(content.workout_date)} · sichtbar: {str(content.visibility)}
          </p>
        </>
      )}
      {type === "message" && (
        <>
          <p className="muted">
            Kopie beim Melden gespeichert: die gemeldete Nachricht mit bis zu 5 Nachrichten davor und danach. Der übrige
            Chat ist nicht einsehbar.
          </p>
          <ol className="snapshots">
            {asArray(content.snapshots).map((value) => {
              const m = asRecord(value);
              const photo = strOrNull(m.post_photo_path);
              return (
                <li key={str(m.message_id)} className={bool(m.is_reported) ? "snapshot reported" : "snapshot"}>
                  <div className="snapshot-meta">
                    <strong>{strOrNull(m.sender_username) !== null ? `@${str(m.sender_username)}` : "Gelöschtes Konto"}</strong>
                    <span className="muted"> · {formatDateTime(strOrNull(m.sent_at))}</span>
                    {bool(m.is_reported) && <span className="pill warn">gemeldet</span>}
                  </div>
                  {str(m.body) !== "" && <p className="user-text">{str(m.body)}</p>}
                  {str(m.kind) === "tag" && <p className="muted">Markierungskarte</p>}
                  {photo !== null && <SignedImage path={photo} alt="Geteilter Beitrag" />}
                  {strOrNull(m.post_id) !== null && photo === null && <p className="muted">Geteilter Beitrag (nicht verfügbar)</p>}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
