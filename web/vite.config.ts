import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { execSync } from "child_process";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

const commitHash = (() => {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "prod";
  }
})();
const buildTime = new Date().toISOString();

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __COMMIT_HASH__: JSON.stringify(commitHash),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  plugins: [react(), tailwindcss()],
  // Absolute base: Pelipäivä deep-links to /venue/<name>?lat=..&lon=..
  // A relative base ("./") makes /venue/x load /venue/assets/*.js, which the
  // SPA fallback answers with index.html, so the page stays blank.
  base: "/",
});
