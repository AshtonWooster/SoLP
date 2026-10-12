import { useEffect, useState } from "react";
import { CONSENT_KEY, makeConsent, parseConsent, type Consent } from "../shared/consent.ts";

const CHANGED = "solp-consent-changed";
const OPEN = "solp-consent-open";

/** This device's saved cookie choice, or null if it hasn't made one yet. */
export function readConsent(): Consent | null {
  try {
    return parseConsent(localStorage.getItem(CONSENT_KEY));
  } catch {
    return null;
  }
}

export function saveConsent(fonts: boolean) {
  const consent = makeConsent(fonts, Date.now());
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
  } catch {
    // Private windows can refuse storage; the choice still holds until the page closes.
  }
  window.dispatchEvent(new CustomEvent<Consent>(CHANGED, { detail: consent }));
}

/** Reopens the banner, from "Cookie preferences" in the footer or account settings. */
export function openConsent() {
  window.dispatchEvent(new Event(OPEN));
}

/** The current choice, updated live when it changes anywhere on the page. */
export function useConsent(): Consent | null {
  const [consent, setConsent] = useState(readConsent);
  useEffect(() => {
    const onChange = (e: Event) => setConsent((e as CustomEvent<Consent>).detail);
    window.addEventListener(CHANGED, onChange);
    return () => window.removeEventListener(CHANGED, onChange);
  }, []);
  return consent;
}

export function onConsentOpen(fn: () => void) {
  window.addEventListener(OPEN, fn);
  return () => window.removeEventListener(OPEN, fn);
}

export function onConsentChange(fn: (c: Consent) => void) {
  const handler = (e: Event) => fn((e as CustomEvent<Consent>).detail);
  window.addEventListener(CHANGED, handler);
  return () => window.removeEventListener(CHANGED, handler);
}
