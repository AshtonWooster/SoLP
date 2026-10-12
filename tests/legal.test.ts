// The cookie banner's saved choice and the legal pages' placeholders. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CONSENT_VERSION, fontsAllowed, makeConsent, parseConsent } from "../shared/consent.ts";
import { isPlaceholder, LEGAL, LEGAL_PAGES, missingLegalDetails } from "../shared/legal.ts";

test("with no saved choice, the banner shows and optional fonts stay off", () => {
  assert.equal(parseConsent(null), null);
  assert.equal(parseConsent(""), null);
  assert.equal(fontsAllowed(null), false);
});

test("a saved choice is read back as made", () => {
  const yes = makeConsent(true, 123);
  assert.deepEqual(parseConsent(JSON.stringify(yes)), { version: CONSENT_VERSION, fonts: true, decidedAt: 123 });
  assert.equal(fontsAllowed(parseConsent(JSON.stringify(yes))), true);
  assert.equal(fontsAllowed(parseConsent(JSON.stringify(makeConsent(false, 5)))), false);
});

test("a choice from an older banner, or a garbled one, asks again", () => {
  assert.equal(parseConsent(JSON.stringify({ version: CONSENT_VERSION - 1, fonts: true, decidedAt: 1 })), null);
  assert.equal(parseConsent("{not json"), null);
  assert.equal(parseConsent(JSON.stringify({ version: CONSENT_VERSION, fonts: "yes", decidedAt: 1 })), null);
  assert.equal(parseConsent(JSON.stringify({ version: CONSENT_VERSION, fonts: true })), null);
  assert.equal(parseConsent("null"), null);
});

test("placeholders in the legal details are flagged until filled in", () => {
  assert.equal(isPlaceholder("[CONTACT EMAIL]"), true);
  assert.equal(isPlaceholder("hello@example.com"), false);
  assert.equal(isPlaceholder(13), false);
  assert.deepEqual(missingLegalDetails({ operator: "Ashton", contactEmail: "[CONTACT EMAIL]", minimumAge: 13 }), ["contactEmail"]);
  // Every placeholder in the shipped details is listed, so nothing goes live half-filled by accident.
  for (const [k, v] of Object.entries(LEGAL)) assert.equal(missingLegalDetails().includes(k), isPlaceholder(v));
});

test("the footer links to a privacy policy, terms and cookie policy", () => {
  assert.deepEqual(
    LEGAL_PAGES.map((p) => p.path),
    ["/privacy", "/terms", "/cookies"],
  );
});
