import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Link } from "react-router-dom";
import { Loading, PageHeader } from "./components/ui";
import { api, ApiError } from "./lib/api";
import { useLiveUpdates } from "./lib/live";
import type { Me } from "./lib/types";
import { AppointmentsPage } from "./pages/AppointmentsPage";
import { CallDetailPage, CallsPage } from "./pages/CallsPage";
import { InboxPage } from "./pages/InboxPage";
import { InsightsPage } from "./pages/InsightsPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { LoginPage, SignupPage } from "./pages/LoginPage";
import { AboutPage } from "./pages/AboutPage";
import { AccountPage } from "./pages/AccountPage";
import { HelpPage } from "./pages/HelpPage";
import { TeamPage } from "./pages/TeamPage";
import { setTimezone } from "./lib/format";
import { MessagesPage } from "./pages/MessagesPage";
import { OverviewPage } from "./pages/OverviewPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TalkPage } from "./pages/TalkPage";

export function App() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<Me>("/api/v1/auth/me"),
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 2,
  });
  useLiveUpdates(Boolean(me.data));
  if (me.data) setTimezone(me.data.business.timezone);

  useEffect(() => {
    const onUnauth = () => {
      qc.setQueryData(["me"], null);
      navigate("/login");
    };
    window.addEventListener("vo:unauthorized", onUnauth);
    return () => window.removeEventListener("vo:unauthorized", onUnauth);
  }, [qc, navigate]);

  if (me.isLoading) return <Loading label="Starting" />;
  if (me.isError && !(me.error instanceof ApiError && me.error.status === 401)) {
    return (
      <div className="mx-auto max-w-md p-8 pt-24">
        <h1 className="font-display text-2xl font-semibold">Can't reach the server</h1>
        <p className="mt-2 text-sm text-muted">
          The dashboard couldn't talk to the API on port 4000. Check that <code>pnpm dev</code> is still running in your terminal, then reload this page.
        </p>
      </div>
    );
  }

  if (!me.data) {
    return (
      <Routes>
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/about" element={<AboutPage standalone />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/signup" element={<Navigate to="/" replace />} />
      <Route element={<Layout me={me.data} />}>
        <Route index element={<OverviewPage me={me.data} />} />
        <Route path="talk" element={<TalkPage me={me.data} />} />
        <Route path="calls" element={<CallsPage />} />
        <Route path="calls/:id" element={<CallDetailPage />} />
        <Route path="appointments" element={<AppointmentsPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="messages" element={<MessagesPage />} />
        <Route path="knowledge" element={<KnowledgePage />} />
        <Route path="insights" element={<InsightsPage />} />
        <Route path="settings" element={<SettingsPage me={me.data} />} />
        <Route path="team" element={<TeamPage me={me.data} />} />
        <Route path="account" element={<AccountPage me={me.data} />} />
        <Route path="help" element={<HelpPage me={me.data} />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function NotFound() {
  return (
    <div>
      <PageHeader title="Page not found" sub="That link doesn't go anywhere in VoiceOps." />
      <Link to="/" className="font-semibold text-info hover:underline">Go to Today</Link>
    </div>
  );
}
