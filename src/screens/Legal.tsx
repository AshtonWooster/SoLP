import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { isPlaceholder, LEGAL } from "../../shared/legal.ts";
import { Footer } from "../components/Footer.tsx";
import { TopBar } from "../components/TopBar.tsx";
import { openConsent } from "../consent.ts";

// These are templates written from what the app actually stores. They aren't legal advice:
// fill in the details in shared/legal.ts and have someone qualified review them before launch.

/** A detail from shared/legal.ts, highlighted while it's still a placeholder. */
function D({ k }: { k: keyof typeof LEGAL }) {
  const value = LEGAL[k];
  return isPlaceholder(value) ? <mark className="legal-placeholder">{value}</mark> : <>{value}</>;
}

function Email() {
  return isPlaceholder(LEGAL.contactEmail) ? <D k="contactEmail" /> : <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>;
}

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    const before = document.title;
    document.title = `${title} · SoLP`;
    window.scrollTo(0, 0);
    return () => void (document.title = before);
  }, [title]);
  return (
    <>
      <TopBar />
      <main className="legal-page">
        <h1>{title}</h1>
        <p className="muted">
          Effective <D k="effectiveDate" />
        </p>
        {children}
      </main>
      <Footer />
    </>
  );
}

export function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        SoLP is a digital table for the LoR PMTTRPG, run by <D k="operator" /> ("we", "us"). This policy explains what we
        collect when you use SoLP, why, who else handles it, and the choices you have.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Your account:</strong> your email address, the display name you choose, and your theme. Your password is
          handled by Firebase Authentication; we never see it.
        </li>
        <li>
          <strong>What you make in games:</strong> games, characters, character sheets, items, Pages, effects, maps, notes,
          and images you upload (portraits, Page art, maps and token art).
        </li>
        <li>
          <strong>Connection details during play:</strong> to connect your device to the GM's screen, your browser shares
          connection details, including your IP address, with the other devices in your game. These pass briefly through
          our database and are removed once they're no longer needed.
        </li>
        <li>
          <strong>Abuse limits:</strong> how many wrong invite codes your account has tried recently, so codes can't be
          guessed.
        </li>
        <li>
          <strong>Technical logs:</strong> our hosting provider (Google Firebase) records standard request information such
          as IP address, browser type and time, for security and to keep the service running.
        </li>
      </ul>
      <p>We don't use advertising, tracking or analytics, and we don't sell or share your personal information for advertising.</p>

      <h2>Who can see it</h2>
      <ul>
        <li>Other members of a game see your display name and what you add to that game. The GM of a game can see and edit everything in it.</li>
        <li>Your email address is visible only to you (and to us, to run the service).</li>
      </ul>

      <h2>Why we use it</h2>
      <p>
        We use this information only to provide SoLP: to log you in, save and sync your games, connect devices during
        play, and keep the service secure. Where the GDPR or UK GDPR applies, our legal basis is performing our agreement
        with you (the Terms of Service) and our legitimate interest in keeping the service secure. Loading theme fonts from
        Google Fonts is based on your consent, which you can change at any time.
      </p>

      <h2>Services we rely on</h2>
      <ul>
        <li>
          <strong>Google Firebase</strong> (Authentication, Firestore, Cloud Storage, Cloud Functions, Hosting) stores and
          processes data on our behalf. See{" "}
          <a href="https://firebase.google.com/support/privacy" target="_blank" rel="noreferrer">
            Firebase's privacy information
          </a>
          .
        </li>
        <li>
          <strong>Google STUN servers</strong> help devices on different networks find each other during play. They see your
          IP address. If a relay (TURN) server is configured for this site, connections that can't go direct pass through it.
        </li>
        <li>
          <strong>Google Fonts</strong>, only if you allow it in the cookie banner: some themes load fonts from Google, which
          sees your IP address. See{" "}
          <a href="https://developers.google.com/fonts/faq/privacy" target="_blank" rel="noreferrer">
            Google Fonts' privacy FAQ
          </a>
          .
        </li>
      </ul>
      <p>These providers may process data outside your country, including in the United States, under their own safeguards (such as Standard Contractual Clauses).</p>

      <h2>Cookies and device storage</h2>
      <p>
        See the <Link to="/cookies">Cookie Policy</Link>.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep your account and game content until you ask us to delete it. A game's content is kept while the game exists;
        content you added to someone else's game stays in that game unless you ask us to remove it. Connection details are
        removed once they're no longer needed. The wrong invite-code count starts over after an hour.
      </p>

      <h2>Your rights</h2>
      <p>
        Depending on where you live, you may have the right to access, correct, download, or delete your personal
        information, to object to or restrict how we use it, and to withdraw consent. You can change your display name and
        theme in Settings. For anything else, including deleting your account, email <Email />. We'll respond within the
        time the law requires (usually one month). If you're in the EU or UK, you can also complain to your local data
        protection authority. If you're in California, we don't sell or share personal information, and we won't treat you
        differently for using your rights.
      </p>

      <h2>Children</h2>
      <p>
        SoLP isn't meant for children under <D k="minimumAge" />, and they may not make an account. If you think a child has
        given us personal information, email <Email /> and we'll delete it.
      </p>

      <h2>Security</h2>
      <p>
        Data is sent over encrypted connections and protected by access rules that limit each game to its members. No system
        is perfectly secure, so please use a password you don't use anywhere else.
      </p>

      <h2>Changes</h2>
      <p>If we change this policy, we'll update the effective date above, and tell you in the app if the change is significant.</p>

      <h2>Contact</h2>
      <p>
        <D k="operator" />
        <br />
        <D k="address" />
        <br />
        <Email />
      </p>
    </LegalPage>
  );
}

export function Terms() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms are an agreement between you and <D k="operator" /> ("we", "us") for using SoLP. By creating an account
        or using SoLP, you agree to them. If you don't agree, please don't use SoLP.
      </p>

      <h2>Who can use SoLP</h2>
      <p>
        You must be at least <D k="minimumAge" /> years old, and old enough to agree to these terms where you live (or have a
        parent or guardian agree for you). Keep your login details safe; you're responsible for what happens on your account.
      </p>

      <h2>Your content</h2>
      <p>
        You own what you create and upload: characters, maps, images, notes and the rest. You give us permission to store,
        copy and show it as needed to run SoLP for you and the members of your games. This permission ends when the content
        is deleted, except for copies in backups that are cleared on their normal schedule.
      </p>
      <p>Only upload content you have the right to use. When you add something to a game, the game's GM and members can see it, and the GM can change or remove it.</p>

      <h2>Acceptable use</h2>
      <p>Don't use SoLP to:</p>
      <ul>
        <li>break the law, or upload content that infringes someone else's rights;</li>
        <li>harass, threaten or abuse other people, or upload sexual content involving minors;</li>
        <li>try to get into accounts, games or data that aren't yours, or guess invite codes;</li>
        <li>interfere with the service, overload it, or get around its limits or security rules.</li>
      </ul>
      <p>We may remove content or suspend accounts that break these rules.</p>

      <h2>Fan project</h2>
      <p>
        SoLP is an unofficial, fan-made tool. Library of Ruina, Lobotomy Corporation, Limbus Company and related names belong
        to Project Moon. SoLP isn't affiliated with or endorsed by Project Moon.
      </p>

      <h2>The service</h2>
      <p>
        SoLP is provided free and "as is". We may change, pause or stop it, and we don't promise it will always be available
        or that saved games will never be lost, so keep your own copies of anything important. To the extent the law allows,
        we aren't liable for indirect or consequential losses, or for losses from content other users add. Nothing in these
        terms limits rights you have that can't be limited by law.
      </p>

      <h2>Ending</h2>
      <p>
        You can stop using SoLP at any time and ask us to delete your account by emailing <Email />. We may close accounts
        that break these terms.
      </p>

      <h2>Changes and law</h2>
      <p>
        We may update these terms; we'll change the effective date above and tell you in the app if the change is
        significant. Continuing to use SoLP after that means you accept the new terms. These terms are governed by the laws
        of <D k="jurisdiction" />.
      </p>

      <h2>Contact</h2>
      <p>
        Questions? Email <Email />.
      </p>
    </LegalPage>
  );
}

export function Cookies() {
  return (
    <LegalPage title="Cookie Policy">
      <p>
        SoLP doesn't use advertising or analytics cookies. It keeps a few things in your browser's storage so the site works,
        and asks before loading fonts from Google.
      </p>

      <h2>Always on (needed for the site to work)</h2>
      <table className="legal-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Set by</th>
            <th>What it's for</th>
            <th>How long</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>firebaseLocalStorageDb (IndexedDB)</td>
            <td>Firebase Authentication</td>
            <td>Keeps you logged in on this device.</td>
            <td>Until you log out</td>
          </tr>
          <tr>
            <td>solp-theme</td>
            <td>SoLP</td>
            <td>Opens the site in your theme before your account loads.</td>
            <td>Until you clear site data</td>
          </tr>
          <tr>
            <td>solp.mapSnap</td>
            <td>SoLP</td>
            <td>Remembers whether the map editor snaps to the grid.</td>
            <td>Until you clear site data</td>
          </tr>
          <tr>
            <td>solp-consent</td>
            <td>SoLP</td>
            <td>Remembers your choice in the cookie banner.</td>
            <td>Until you clear site data</td>
          </tr>
        </tbody>
      </table>

      <h2>Optional (only if you allow it)</h2>
      <table className="legal-table">
        <thead>
          <tr>
            <th>Service</th>
            <th>What it's for</th>
            <th>What it receives</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Google Fonts</td>
            <td>The Library, Reception, Facility, Limbus and Backstreets themes' fonts. Without it, themes use your device's fonts.</td>
            <td>Your IP address and browser details, when the fonts load</td>
          </tr>
        </tbody>
      </table>

      <h2>Changing your choice</h2>
      <p>
        <button type="button" className="link" onClick={openConsent}>
          Open cookie preferences
        </button>{" "}
        (also in the footer of every page). You can also clear this site's data in your browser settings, which logs you out.
      </p>
      <p>
        For more about how we handle your information, see the <Link to="/privacy">Privacy Policy</Link>.
      </p>
    </LegalPage>
  );
}
