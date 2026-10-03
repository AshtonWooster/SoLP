import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import type { UserDoc } from "../../shared/types.ts";
import { useAuth } from "../api.ts";
import { auth, db, friendlyError } from "../firebase.ts";

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

  // During signup the account exists before its display name is saved; wait for both.
  if (user && !busy) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "signup") {
        const name = displayName.trim().slice(0, 32);
        if (!name) throw new Error("Enter a display name.");
        if (password.length < 8) throw Object.assign(new Error(), { code: "auth/weak-password" });
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(cred.user, { displayName: name });
        await setDoc(doc(db, "users", cred.user.uid), { displayName: name, email: cred.user.email ?? "" } satisfies UserDoc);
        setUser({ id: cred.user.uid, email: cred.user.email ?? "", displayName: name });
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
      navigate(next, { replace: true });
    } catch (err) {
      setError(friendlyError(err));
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
