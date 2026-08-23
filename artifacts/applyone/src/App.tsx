import { useEffect } from "react";
import { Redirect, Route, Router as WouterRouter, Switch, useLocation } from "wouter";

import HomePage from "@/app/page";
import { ErrorBoundary } from "@/components/error-boundary";
import { SupabaseAuthProvider, useSupabaseAuth } from "@/lib/supabase-auth";
import { AuthScreen } from "@/pages/auth-screen";
import { AuthenticatedWorkspace } from "@/pages/authenticated-workspace";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function HomeRoute() {
  const { session, loading } = useSupabaseAuth();
  if (loading) return null;
  return session ? <Redirect to="/app" /> : <HomePage />;
}

function ProtectedWorkspace() {
  const { session, loading } = useSupabaseAuth();
  if (loading) return null;
  return session ? <AuthenticatedWorkspace /> : <Redirect to="/" />;
}

function AuthCallback() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    const next = new URLSearchParams(window.location.search).get("next");
    setLocation(next?.startsWith("/") ? next : "/app");
  }, [setLocation]);
  return <div className="grid min-h-screen place-items-center bg-canvas text-sm text-ink-muted">Finishing sign-in…</div>;
}

function RoutedApp() {
  return (
    <ErrorBoundary>
      <Switch>
        <Route path="/" component={HomeRoute} />
        <Route path="/sign-in"><AuthScreen mode="sign-in" /></Route>
        <Route path="/sign-up"><AuthScreen mode="sign-up" /></Route>
        <Route path="/forgot-password"><AuthScreen mode="forgot-password" /></Route>
        <Route path="/reset-password"><AuthScreen mode="reset-password" /></Route>
        <Route path="/auth/callback"><AuthCallback /></Route>
        <Route path="/app"><ProtectedWorkspace /></Route>
        <Route path="/app/:rest*"><ProtectedWorkspace /></Route>
        <Route><HomeRoute /></Route>
      </Switch>
    </ErrorBoundary>
  );
}

function App() {
  return <SupabaseAuthProvider><WouterRouter base={basePath}><RoutedApp /></WouterRouter></SupabaseAuthProvider>;
}

export default App;