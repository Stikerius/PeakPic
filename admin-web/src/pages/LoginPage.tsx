import { useState, type FormEvent } from "react";

import { useAuth } from "../lib/auth";
import { configError } from "../lib/supabase";

export function LoginPage() {
  const { state, signIn, verifyCode, signOut } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent, action: () => Promise<string | null>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const problem = await action();
    setBusy(false);
    setError(problem);
  }

  if (configError !== null) {
    return (
      <div className="auth-card">
        <h1>PeakPic Moderation</h1>
        <p className="error">{configError}</p>
      </div>
    );
  }

  if (state.step === "loading") {
    return <div className="auth-card"><p className="muted">Lädt …</p></div>;
  }

  if (state.step === "no-role") {
    return (
      <div className="auth-card">
        <h1>Kein Zugang</h1>
        <p>Dieses Konto hat keine Moderationsrolle.</p>
        <button type="button" className="button" onClick={signOut}>Abmelden</button>
      </div>
    );
  }

  if (state.step === "enroll" || state.step === "verify") {
    return (
      <form className="auth-card" onSubmit={(e) => void submit(e, () => verifyCode(code))}>
        <h1>Zwei-Faktor-Bestätigung</h1>
        {state.step === "enroll" ? (
          <>
            <p>Richte zuerst eine Authenticator-App ein (z.B. die Passwort-App von iOS): QR-Code scannen, dann den Code eingeben.</p>
            <img className="qr" src={state.qrCode} alt="QR-Code für die Authenticator-App" />
            <p className="muted">Oder den Schlüssel manuell eingeben: <code>{state.secret}</code></p>
          </>
        ) : (
          <p>Gib den 6-stelligen Code aus deiner Authenticator-App ein.</p>
        )}
        <label className="field">
          <span>Code</span>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={7}
            autoFocus
          />
        </label>
        {error !== null && <p className="error" role="alert">{error}</p>}
        <div className="action-row">
          <button type="submit" className="button primary" disabled={busy}>Bestätigen</button>
          <button type="button" className="button" onClick={signOut}>Abbrechen</button>
        </div>
      </form>
    );
  }

  return (
    <form className="auth-card" onSubmit={(e) => void submit(e, () => signIn(email, password))}>
      <h1>PeakPic Moderation</h1>
      <p className="muted">Nur für Moderatoren und Admins. Zwei-Faktor ist Pflicht.</p>
      <label className="field">
        <span>E-Mail</span>
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
      </label>
      <label className="field">
        <span>Passwort</span>
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error !== null && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="button primary" disabled={busy}>Anmelden</button>
    </form>
  );
}
