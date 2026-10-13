// Typing your email and entering your password again to delete your account. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { deleteEmailMatches, RECENT_SIGN_IN_SECONDS, signedInRecently } from "../shared/deleteAccount.ts";

test("the account is deleted only when its email is typed; case and outer spaces don't matter", () => {
  assert.equal(deleteEmailMatches("p1@x.test", "p1@x.test"), true);
  assert.equal(deleteEmailMatches("  P1@X.test ", "p1@x.test"), true);
  assert.equal(deleteEmailMatches("p1@x", "p1@x.test"), false);
  assert.equal(deleteEmailMatches("p2@x.test", "p1@x.test"), false);
  assert.equal(deleteEmailMatches("", "p1@x.test"), false);
  assert.equal(deleteEmailMatches("  ", ""), false);
});

test("the password must have been entered in the last few minutes", () => {
  const now = 1_000_000_000_000;
  const secs = now / 1000;
  assert.equal(signedInRecently(secs, now), true);
  assert.equal(signedInRecently(secs - RECENT_SIGN_IN_SECONDS, now), true);
  assert.equal(signedInRecently(secs - RECENT_SIGN_IN_SECONDS - 1, now), false);
  assert.equal(signedInRecently(secs - 86400, now), false);
  assert.equal(signedInRecently(undefined, now), false);
  assert.equal(signedInRecently(Number.NaN, now), false);
});
