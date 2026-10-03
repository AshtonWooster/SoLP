import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import type { User } from "../../shared/types.ts";
import { api, useAuth } from "../api.ts";

/** Only follow same-site paths after login, never another website. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = mode === "signup" ? { email, displayName, password } : { email, password };
      const res = await api<{ user: User }>(`/auth/${mode}`, body);
      setUser(res.user);
      navigate(next, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const other = mode === "login" ? "signup" : "login";
  const otherHref = `/${other}${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <main className="center">
      <Link to="/" className="brand">SoLP</Link>
      <h1>{mode === "login" ? "Log in" : "Create an account"}</h1>
      <form className="stack" onSubmit={submit}>
        <label>
          Email
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        {mode === "signup" && (
          <label>
            Display name
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={32} required />
          </label>
        )}
        <label>
          Password
          <input
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={mode === "signup" ? 8 : undefined}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="big-button" disabled={busy}>
          {mode === "login" ? "Log in" : "Sign up"}
        </button>
      </form>
      <p className="muted">
        {mode === "login" ? "New here? " : "Already have an account? "}
        <Link to={otherHref}>{mode === "login" ? "Create an account" : "Log in"}</Link>
      </p>
    </main>
  );
}

export const Login = () => <AuthForm mode="login" />;
export const Signup = () => <AuthForm mode="signup" />;
