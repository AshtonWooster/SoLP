import { Link } from "react-router-dom";
import { LEGAL_PAGES } from "../../shared/legal.ts";
import { openConsent } from "../consent.ts";

/** Legal links at the bottom of the account pages (not the board, GM or phone play screens). */
export function Footer({ build = false }: { build?: boolean }) {
  return (
    <footer className="site-footer">
      <nav aria-label="Legal">
        {LEGAL_PAGES.map((p) => (
          <Link key={p.path} to={p.path}>
            {p.title}
          </Link>
        ))}
        <button type="button" className="link" onClick={openConsent}>
          Cookie preferences
        </button>
      </nav>
      {build && <p className="build muted small">Build {__APP_VERSION__}</p>}
      <p className="muted small">SoLP is a fan-made table for the LoR PMTTRPG. It isn't affiliated with or endorsed by Project Moon.</p>
    </footer>
  );
}
