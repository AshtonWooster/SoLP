import { useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { User } from "../shared/types.ts";
import { api, AuthContext, useAuth } from "./api.ts";
import { Home } from "./screens/Home.tsx";
import { Login, Signup } from "./screens/Auth.tsx";
import { Join } from "./screens/Join.tsx";
import { GamePage } from "./screens/GamePage.tsx";
import { Board } from "./screens/Board.tsx";
import { Gm } from "./screens/Gm.tsx";
import { Play } from "./screens/Play.tsx";
import "./styles.css";

/** Sends logged-out visitors to the login page, then back here afterwards. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (user === undefined) return <main className="center muted">Loading…</main>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return children;
}

function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    api<{ user: User | null }>("/auth/me")
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  const authed = (el: ReactNode) => <RequireAuth>{el}</RequireAuth>;
  return (
    <AuthContext.Provider value={{ user, setUser }}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/join/:code" element={authed(<Join />)} />
          <Route path="/games/:id" element={authed(<GamePage />)} />
          <Route path="/games/:id/gm" element={authed(<Gm />)} />
          <Route path="/games/:id/board" element={authed(<Board />)} />
          <Route path="/games/:id/play" element={authed(<Play />)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
