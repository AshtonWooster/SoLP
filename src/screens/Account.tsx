import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { EmailAuthProvider, reauthenticateWithCredential, updateProfile } from "firebase/auth";
import { collection, doc, getDocs, query, setDoc, where, writeBatch } from "firebase/firestore";
import { cleanDisplayName, displayNameError, THEME_INFO, THEMES, themeOf, type ThemeId } from "../../shared/account.ts";
import { deleteEmailMatches } from "../../shared/deleteAccount.ts";
import type { GameDoc, User, UserDoc } from "../../shared/types.ts";
import { useAuth, useDoc } from "../api.ts";
import { TopBar } from "../components/TopBar.tsx";
import { auth, db, deleteAccountFn, friendlyError, logOut } from "../firebase.ts";
import { applyTheme, savedTheme } from "../theme.ts";
import { openConsent, useConsent } from "../consent.ts";
import { Footer } from "../components/Footer.tsx";
import { StableLabel } from "../components/StableLabel.tsx";

/** Account settings, from the gear in the top bar: your display name, the app's look, and deleting your account. */
export function Account() {
  const { user, setUser } = useAuth();
  const me = user!;
  const profile = useDoc<UserDoc>(`users/${me.id}`);
  const [name, setName] = useState(me.displayName);
  const [nameMsg, setNameMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<ThemeId>(savedTheme());
  const [themeMsg, setThemeMsg] = useState("");
  const consent = useConsent();

  // Once the account loads, show the theme it has saved.
  const stored = profile.data?.theme;
  useEffect(() => {
    if (!profile.loading) setTheme(themeOf(stored));
  }, [profile.loading, stored]);

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    const error = displayNameError(name);
    if (error) return setNameMsg(error);
    const clean = cleanDisplayName(name);
    setBusy(true);
    setNameMsg("");
    try {
      if (auth.currentUser) await updateProfile(auth.currentUser, { displayName: clean });
      await setDoc(doc(db, "users", me.id), { displayName: clean, email: me.email }, { merge: true });
      // Every game you're in shows the new name in its player lists.
      const games = await getDocs(query(collection(db, "games"), where("memberIds", "array-contains", me.id)));
      const batch = writeBatch(db);
      games.forEach((g) => batch.update(g.ref, { [`members.${me.id}.displayName`]: clean }));
      await batch.commit();
      setUser({ ...me, displayName: clean });
      setName(clean);
      setNameMsg("Saved.");
    } catch (err) {
      setNameMsg(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const pickTheme = async (next: ThemeId) => {
    setTheme(next);
    applyTheme(next);
    setThemeMsg("");
    try {
      await setDoc(doc(db, "users", me.id), { displayName: profile.data?.displayName || me.displayName, email: me.email, theme: next }, { merge: true });
      setThemeMsg(`${THEME_INFO[next].name} saved. It follows you onto every device you log in on.`);
    } catch (err) {
      setThemeMsg(friendlyError(err));
    }
  };

  return (
    <>
      <TopBar />
      <main className="settings-page account-page">
        <header className="sheet-header">
          <Link to="/" className="muted">
            ← Your games
          </Link>
          <h1>Settings</h1>
        </header>

        <form className="panel settings-section stack" onSubmit={saveName}>
          <h2>Display name</h2>
          <p className="muted small">What GMs and other players see in every game you're in.</p>
          <div className="row">
            <input id="display-name" aria-label="Display name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
            <button disabled={busy || cleanDisplayName(name) === me.displayName}><StableLabel labels={["Save", "Saving…"]} show={busy ? 1 : 0} /></button>
            {nameMsg && (
              <span className={nameMsg === "Saved." ? "muted small inline-note" : "error small inline-note"} role="status">
                {nameMsg}
              </span>
            )}
          </div>
        </form>

        <section className="panel settings-section stack">
          <h2>Theme</h2>
          <p className="muted small">Changes the look of every page on your devices. Other people keep their own.</p>
          <div className="theme-options" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <button
                type="button"
                key={t}
                role="radio"
                aria-checked={theme === t}
                className={`theme-option theme-swatch-${t}${theme === t ? " selected" : ""}`}
                onClick={() => pickTheme(t)}
              >
                <span className="theme-preview" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <strong>{THEME_INFO[t].name}</strong>
                <span className="muted small">{THEME_INFO[t].description}</span>
              </button>
            ))}
          </div>
          {themeMsg && (
            <p className="muted small" role="status">
              {themeMsg}
            </p>
          )}
        </section>

        <section className="panel settings-section stack">
          <h2>Privacy</h2>
          <p className="muted small">
            Theme fonts from Google Fonts are {consent?.fonts ? "on" : "off"} on this device.{" "}
            {consent?.fonts ? "" : "Themes use your device's own fonts until you allow them. "}
            <button type="button" className="link" onClick={openConsent}>
              Cookie preferences
            </button>
          </p>
          <p className="muted small">
            To download a copy of your data, see the <Link to="/privacy">Privacy Policy</Link>. To delete your account, use the section below.
          </p>
        </section>

        <DeleteAccountSection me={me} />
      </main>
      <Footer />
    </>
  );
}

/**
 * Deleting your account: you say you're sure (seeing which of your games go with it), then type
 * your email and enter your password again. deleteAccount (functions/src) does the deleting.
 */
function DeleteAccountSection({ me }: { me: User }) {
  const [step, setStep] = useState<"idle" | "sure" | "confirm">("idle");
  const [gmGames, setGmGames] = useState<string[] | null>(null);
  const [typed, setTyped] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cancel = () => {
    setStep("idle");
    setTyped("");
    setPassword("");
    setError("");
  };
  const start = async () => {
    setStep("sure");
    setGmGames(null);
    try {
      const games = await getDocs(query(collection(db, "games"), where("memberIds", "array-contains", me.id)));
      setGmGames(games.docs.filter((g) => (g.data() as GameDoc).gmId === me.id).map((g) => (g.data() as GameDoc).name));
    } catch (err) {
      setError(friendlyError(err));
    }
  };
  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      // The server only deletes an account whose password was entered in the last few minutes.
      if (auth.currentUser) await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(me.email, password));
      await deleteAccountFn({ email: typed });
      // Logging out reloads the page straight onto the login page with the notice.
      await logOut("/login?deleted=1");
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  };
  const ready = deleteEmailMatches(typed, me.email) && password !== "" && !busy;
  return (
    <section className="panel settings-section delete-game" aria-label="Delete account">
      <h2>Delete account</h2>
      <p className="muted small">
        Deletes your login and your data: your account settings, your characters and uploaded images in every game, your items and effects still waiting for approval, and every game you
        GM, for all its players. Items and effects a GM already approved stay in their game. This can't be undone.
      </p>
      {step === "idle" && (
        <div className="row wrap">
          <button type="button" className="danger" onClick={start}>
            Delete account…
          </button>
        </div>
      )}
      {step === "sure" && (
        <div className="delete-game-step" role="alertdialog" aria-label="Are you sure?">
          <p>
            <strong>Are you sure you want to delete your account?</strong>
          </p>
          {gmGames === null && !error && <p className="muted small">Checking your games…</p>}
          {gmGames && gmGames.length === 0 && <p className="muted small">You don't GM any games, so no games will be deleted. You'll leave the games you play in.</p>}
          {gmGames && gmGames.length > 0 && (
            <>
              <p>
                You GM {gmGames.length === 1 ? "this game" : `these ${gmGames.length} games`}. {gmGames.length === 1 ? "It" : "They"} will be deleted for everyone, and your players lose their characters in{" "}
                {gmGames.length === 1 ? "it" : "them"}:
              </p>
              <ul className="delete-account-games">
                {gmGames.map((n, i) => (
                  <li key={i}>
                    <strong>{n}</strong>
                  </li>
                ))}
              </ul>
            </>
          )}
          {error && <p className="error small">{error}</p>}
          <div className="row wrap">
            <button type="button" className="danger" disabled={gmGames === null} onClick={() => setStep("confirm")}>
              Yes, I'm sure
            </button>
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {step === "confirm" && (
        <form
          className="delete-game-step"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) remove();
          }}
        >
          <label className="field">
            <span>
              Type your email, <strong className="delete-game-name">{me.email}</strong>, to delete your account
            </span>
            <input aria-label="Your email" value={typed} autoFocus autoComplete="off" spellCheck={false} onChange={(e) => setTyped(e.target.value)} />
          </label>
          <label className="field">
            <span>Your password</span>
            <input aria-label="Your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <p className="error small">{error}</p>}
          <div className="row wrap">
            <button type="submit" className="danger" disabled={!ready}>
              <StableLabel labels={["Delete my account forever", "Deleting…"]} show={busy ? 1 : 0} />
            </button>
            <button type="button" onClick={cancel} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
