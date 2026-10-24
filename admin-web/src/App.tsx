import { Layout } from "./components/Layout";
import { AppearanceMenu } from "./components/AppearanceMenu";
import { useAppearance } from "./lib/appearanceContext";
import { useAuth } from "./lib/auth";
import { DashboardBrandProvider } from "./lib/dashboardBrand";
import { useRoute } from "./lib/router";
import { AuditPage } from "./pages/AuditPage";
import { DesignPage } from "./pages/DesignPage";
import { LegalEditPage } from "./pages/LegalEditPage";
import { LegalPage } from "./pages/LegalPage";
import { LoginPage } from "./pages/LoginPage";
import { LogosPage } from "./pages/LogosPage";
import { MailPage } from "./pages/MailPage";
import { OverviewPage } from "./pages/OverviewPage";
import { PendingPage } from "./pages/PendingPage";
import { UsagePage } from "./pages/UsagePage";
import { QueuePage } from "./pages/QueuePage";
import { ResetPage } from "./pages/ResetPage";
import { ReportDetailPage } from "./pages/ReportDetailPage";
import { UserDetailPage } from "./pages/UserDetailPage";
import { UsersPage } from "./pages/UsersPage";

export function App() {
  const { state } = useAuth();
  const route = useRoute();
  const { appearance, mode } = useAppearance();

  // Without a staff role and a two-factor session there is only the login page (with a small menu
  // for mode and colour).
  if (state.step !== "ready") {
    return (
      <DashboardBrandProvider mode={mode} palette={appearance.palette}>
        <div className="auth-screen">
          <AppearanceMenu />
          <LoginPage />
        </div>
      </DashboardBrandProvider>
    );
  }

  // Admin pages: the SQL functions check is_admin() as well.
  const isAdmin = state.role === "admin";

  return (
    <DashboardBrandProvider mode={mode} palette={appearance.palette}>
      <Layout route={route}>
        {route.page === "overview" && <OverviewPage />}
        {route.page === "queue" && <QueuePage />}
        {route.page === "report" && <ReportDetailPage key={route.id} id={route.id} />}
        {route.page === "users" && <UsersPage />}
        {route.page === "user" && <UserDetailPage key={route.id} id={route.id} />}
        {route.page === "audit" && <AuditPage />}
        {route.page === "legal" && isAdmin && <LegalPage />}
        {route.page === "legal-edit" && isAdmin && <LegalEditPage key={route.id} id={route.id} />}
        {route.page === "pending" && isAdmin && <PendingPage />}
        {route.page === "usage" && isAdmin && <UsagePage />}
        {route.page === "reset" && isAdmin && <ResetPage jobId={null} />}
        {route.page === "reset-job" && isAdmin && <ResetPage key={route.id} jobId={route.id} />}
        {route.page === "mail" && isAdmin && <MailPage campaignId={null} />}
        {route.page === "mail-campaign" && isAdmin && <MailPage key={route.id} campaignId={route.id} />}
        {route.page === "logos" && isAdmin && <LogosPage />}
        {route.page === "design" && isAdmin && <DesignPage />}
      </Layout>
    </DashboardBrandProvider>
  );
}
