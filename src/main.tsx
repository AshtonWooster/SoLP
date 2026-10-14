import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { themeOf } from "../shared/account.ts";
import type { User } from "../shared/types.ts";
import { AuthContext, useAuth } from "./api.ts";
import { auth, db } from "./firebase.ts";
import { applyTheme, savedTheme } from "./theme.ts";
import { Home } from "./screens/Home.tsx";
import { Login, Signup } from "./screens/Auth.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { CookieBanner } from "./components/CookieBanner.tsx";
import "./styles.css";
import "./themes.css";

applyTheme(savedTheme());

// Each screen loads only when it's opened, so the front page doesn't download the GM table,
// the effect builder and every other screen first.
const Join = lazy(() => import("./screens/Join.tsx").then((m) => ({ default: m.Join })));
const GamePage = lazy(() => import("./screens/GamePage.tsx").then((m) => ({ default: m.GamePage })));
const Board = lazy(() => import("./screens/Board.tsx").then((m) => ({ default: m.Board })));
const Gm = lazy(() => import("./screens/Gm.tsx").then((m) => ({ default: m.Gm })));
const Play = lazy(() => import("./screens/Play.tsx").then((m) => ({ default: m.Play })));
const CharacterSheet = lazy(() => import("./screens/CharacterSheet.tsx").then((m) => ({ default: m.CharacterSheet })));
const Npcs = lazy(() => import("./screens/Npcs.tsx").then((m) => ({ default: m.Npcs })));
const Settings = lazy(() => import("./screens/Settings.tsx").then((m) => ({ default: m.Settings })));
const Items = lazy(() => import("./screens/Items.tsx").then((m) => ({ default: m.Items })));
const Effects = lazy(() => import("./screens/Effects.tsx").then((m) => ({ default: m.Effects })));
const Vfx = lazy(() => import("./screens/Vfx.tsx").then((m) => ({ default: m.Vfx })));
const Account = lazy(() => import("./screens/Account.tsx").then((m) => ({ default: m.Account })));
const Privacy = lazy(() => import("./screens/Legal.tsx").then((m) => ({ default: m.Privacy })));
const Terms = lazy(() => import("./screens/Legal.tsx").then((m) => ({ default: m.Terms })));
const Cookies = lazy(() => import("./screens/Legal.tsx").then((m) => ({ default: m.Cookies })));

/** The enemy templates page became the Character editor. */
function OldEnemiesLink() {
  const location = useLocation();
  return <Navigate to={location.pathname.replace(/\/enemies$/, "/npcs")} replace />;
}

function Loading() {
  return <main className="center muted">Loading…</main>;
}

/** Sends logged-out visitors to the login page, then back here afterwards. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (user === undefined) return <Loading />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return children;
}

function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(
    () =>
      onAuthStateChanged(auth, (u) =>
        setUser(u ? { id: u.uid, email: u.email ?? "", displayName: u.displayName ?? u.email ?? "" } : null),
      ),
    [],
  );
  // Your theme follows your account onto every device you log in on.
  const uid = user?.id;
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      doc(db, "users", uid),
      (snap) => snap.exists() && applyTheme(themeOf(snap.data().theme)),
      () => {},
    );
  }, [uid]);

  const authed = (el: ReactNode) => <RequireAuth>{el}</RequireAuth>;
  return (
    <AuthContext.Provider value={{ user, setUser }}>
      <BrowserRouter>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/cookies" element={<Cookies />} />
            <Route path="/settings" element={authed(<Account />)} />
            <Route path="/join/:code" element={authed(<Join />)} />
            <Route path="/games/:id" element={authed(<GamePage />)} />
            <Route path="/games/:id/gm" element={authed(<Gm />)} />
            <Route path="/games/:id/board" element={authed(<Board />)} />
            <Route path="/games/:id/play" element={authed(<Play />)} />
            <Route path="/games/:id/characters/:uid" element={authed(<CharacterSheet />)} />
            <Route path="/games/:id/npcs" element={authed(<Npcs />)} />
            <Route path="/games/:id/settings" element={authed(<Settings />)} />
            <Route path="/games/:id/enemies" element={<OldEnemiesLink />} />
            <Route path="/games/:id/items" element={authed(<Items />)} />
            <Route path="/games/:id/effects" element={authed(<Effects />)} />
            <Route path="/games/:id/vfx" element={authed(<Vfx />)} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        <CookieBanner />
      </BrowserRouter>
    </AuthContext.Provider>
  );
}

// A new deploy can remove the files an old open page asks for: reload to get the new ones.
window.addEventListener("vite:preloadError", () => location.reload());

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
