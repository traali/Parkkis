import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { execSync } from "child_process";

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
    __APP_VERSION__: JSON.stringify("1.0.0"),
    __COMMIT_HASH__: JSON.stringify(commitHash),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  plugins: [react(), tailwindcss()],
  // Deployment base for GitHub Pages
  base: "/Parkkis/",
});
