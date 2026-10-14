import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** The commit this site was built from, shown on the front page to confirm which version is deployed. */
function buildVersion(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    rolldownOptions: {
      output: {
        // Libraries change less often than the app, so they get their own files that stay cached
        // across deploys. Firestore alone is near the 500 kB limit, so its helpers get files of their own.
        codeSplitting: {
          // Otherwise a group swallows every library it imports and Firestore takes all of Firebase.
          includeDependenciesRecursively: false,
          groups: [
            { name: "vendor-react", test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|cookie|set-cookie-parser)[\\/]/ },
            // Firebase's shared core, which every other Firebase file imports and which imports none of them.
            { name: "vendor-firebase-core", test: /node_modules[\\/](@firebase[\\/](app|util|component|logger)|firebase[\\/]app|idb|tslib)[\\/]/ },
            { name: "vendor-firestore", test: /node_modules[\\/]@firebase[\\/]firestore[\\/]/ },
            { name: "vendor-firestore-net", test: /node_modules[\\/](@firebase[\\/]webchannel-wrapper|re2js)[\\/]/ },
            { name: "vendor-firebase", test: /node_modules[\\/]@?firebase[\\/]/ },
          ],
        },
      },
    },
  },
  define: { __APP_VERSION__: JSON.stringify(buildVersion()) },
});
