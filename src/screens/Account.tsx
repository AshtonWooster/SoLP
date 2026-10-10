import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { updateProfile } from "firebase/auth";
import { collection, doc, getDocs, query, setDoc, where, writeBatch } from "firebase/firestore";
import { cleanDisplayName, displayNameError, THEME_INFO, THEMES, themeOf, type ThemeId } from "../../shared/account.ts";
import type { UserDoc } from "../../shared/types.ts";
import { useAuth, useDoc } from "../api.ts";
import { TopBar } from "../components/TopBar.tsx";
import { auth, db, friendlyError } from "../firebase.ts";
import { applyTheme, savedTheme } from "../theme.ts";

/** Account settings, from the gear in the top bar: your display name and the app's look. */
export function Account() {
  const { user, setUser } = useAuth();
  const me = user!;
  const profile = useDoc<UserDoc>(`users/${me.id}`);
  const [name, setName] = useState(me.displayName);
  const [nameMsg, setNameMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<ThemeId>(savedTheme());
  const [themeMsg, setThemeMsg] = useState("");

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
            <button disabled={busy || cleanDisplayName(name) === me.displayName}>{busy ? "Saving…" : "Save"}</button>
          </div>
          {nameMsg && (
            <p className={nameMsg === "Saved." ? "muted small" : "error small"} role="status">
              {nameMsg}
            </p>
          )}
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
      </main>
    </>
  );
}
