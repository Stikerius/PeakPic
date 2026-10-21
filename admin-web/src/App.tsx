import { useEffect, useState } from "react";

import { Layout } from "./components/Layout";
import { useAuth } from "./lib/auth";
import { useRoute } from "./lib/router";
import { AuditPage } from "./pages/AuditPage";
import { LoginPage } from "./pages/LoginPage";
import { OverviewPage } from "./pages/OverviewPage";
import { QueuePage } from "./pages/QueuePage";
import { ReportDetailPage } from "./pages/ReportDetailPage";
import { UserDetailPage } from "./pages/UserDetailPage";
import { UsersPage } from "./pages/UsersPage";

type Theme = "light" | "dark";
const THEME_KEY = "peakpic-admin-theme";

function initialTheme(): Theme {
  // Only the colour preference is stored; no data from the dashboard ever is.
  const stored = window.localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function App() {
  const { state } = useAuth();
  const route = useRoute();
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Without a staff role and a two-factor session there is only the login page.
  if (state.step !== "ready") {
    return (
      <div className="auth-screen">
        <LoginPage />
      </div>
    );
  }

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    window.localStorage.setItem(THEME_KEY, next);
    setTheme(next);
  }

  return (
    <Layout route={route} theme={theme} onToggleTheme={toggleTheme}>
      {route.page === "overview" && <OverviewPage />}
      {route.page === "queue" && <QueuePage />}
      {route.page === "report" && <ReportDetailPage key={route.id} id={route.id} />}
      {route.page === "users" && <UsersPage />}
      {route.page === "user" && <UserDetailPage key={route.id} id={route.id} />}
      {route.page === "audit" && <AuditPage />}
    </Layout>
  );
}
