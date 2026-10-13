// Runs the security-rules tests in the Firebase emulators (`npm run test:rules`).
//
// firebase-tools sends every request through HTTPS_PROXY when it's set, ignoring NO_PROXY,
// including the Storage emulator's lookups into the Firestore emulator for `firestore.get()`
// in storage.rules. Behind a proxy those lookups fail, the game reads as missing, and every
// storage upload is denied. So: download the emulators with the proxy, then run them without it.
import { spawnSync } from "node:child_process";

const PROXY_VARS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"];
const TESTS = [
  "tests/rules.test.ts",
  "tests/deleteGameFn.test.ts",
  "tests/deleteAccountFn.test.ts",
  "tests/removePlayerFn.test.ts",
  "tests/sweepImagesFn.test.ts",
];

function firebase(args, env) {
  const r = spawnSync("firebase", args, { stdio: "inherit", shell: true, env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const env = { ...process.env };
if (PROXY_VARS.some((v) => env[v])) {
  // Fetch the emulator jars now, while the proxy is still set (no-op once they're cached).
  firebase(["setup:emulators:firestore"], env);
  firebase(["setup:emulators:storage"], env);
  for (const v of PROXY_VARS) delete env[v];
}
firebase(
  ["emulators:exec", "--project", "demo-solp", "--only", "firestore,storage",
    `"node --test --test-concurrency=1 ${TESTS.join(" ")}"`],
  env,
);
