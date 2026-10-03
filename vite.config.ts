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
  build: { target: "es2022" },
  define: { __APP_VERSION__: JSON.stringify(buildVersion()) },
});
