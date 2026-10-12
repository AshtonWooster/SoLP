import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { onConsentOpen, saveConsent, useConsent } from "../consent.ts";

/**
 * Asks once per device. Login and settings storage is always on (the site can't work without it);
 * the only optional extra is theme fonts from Google Fonts, off until the visitor says yes.
 */
export function CookieBanner() {
  const consent = useConsent();
  const [reopened, setReopened] = useState(false);
  const [fonts, setFonts] = useState(consent?.fonts ?? false);
  useEffect(() => onConsentOpen(() => setReopened(true)), []);
  useEffect(() => setFonts(consent?.fonts ?? false), [consent]);

  if (consent && !reopened) return null;
  const choose = (allowFonts: boolean) => {
    saveConsent(allowFonts);
    setReopened(false);
  };

  return (
    <section className="cookie-banner" role="dialog" aria-modal="false" aria-labelledby="cookie-banner-title">
      <h2 id="cookie-banner-title">Cookies and storage</h2>
      <p>
        SoLP stores your login and a few settings on this device so the site works. We don't use advertising or analytics
        cookies. Some themes can also load fonts from Google Fonts, which shares your IP address with Google.{" "}
        <Link to="/cookies">Cookie Policy</Link>
      </p>
      {reopened && (
        <div className="cookie-options">
          <label className="cookie-option">
            <input type="checkbox" checked disabled /> Essential: login and settings (always on)
          </label>
          <label className="cookie-option">
            <input type="checkbox" checked={fonts} onChange={(e) => setFonts(e.target.checked)} /> Theme fonts from Google Fonts
          </label>
        </div>
      )}
      <div className="cookie-actions">
        {reopened ? (
          <button className="primary" onClick={() => choose(fonts)}>
            Save choices
          </button>
        ) : (
          <>
            <button onClick={() => choose(false)}>Essential only</button>
            <button className="primary" onClick={() => choose(true)}>
              Accept all
            </button>
          </>
        )}
      </div>
    </section>
  );
}
