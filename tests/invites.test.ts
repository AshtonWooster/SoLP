// Limits on guessing invite codes. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { afterWrongCode, JOIN_MAX_FAILURES, JOIN_WINDOW_MS, type JoinAttempts, mayTryCode, minutesUntilRetry } from "../shared/invites.ts";

test("an account with no wrong codes may try", () => {
  assert.equal(mayTryCode(undefined, 0), true);
});

test("after too many wrong codes in an hour, the account waits", () => {
  let a: JoinAttempts | undefined;
  for (let i = 0; i < JOIN_MAX_FAILURES - 1; i++) a = afterWrongCode(a, 1000 + i);
  assert.equal(mayTryCode(a, 2000), true);
  a = afterWrongCode(a, 2000);
  assert.equal(a.failures, JOIN_MAX_FAILURES);
  assert.equal(mayTryCode(a, 2001), false);
  assert.equal(minutesUntilRetry(a, 1000), 60);
  assert.equal(minutesUntilRetry(a, 1000 + JOIN_WINDOW_MS - 1), 1);
});

test("the count starts over once the hour is up", () => {
  const a: JoinAttempts = { since: 0, failures: JOIN_MAX_FAILURES };
  assert.equal(mayTryCode(a, JOIN_WINDOW_MS), true);
  assert.deepEqual(afterWrongCode(a, JOIN_WINDOW_MS), { since: JOIN_WINDOW_MS, failures: 1 });
  assert.deepEqual(afterWrongCode({ since: 0, failures: 3 }, 10), { since: 0, failures: 4 });
});
