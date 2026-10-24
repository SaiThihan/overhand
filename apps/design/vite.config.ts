import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const web = (p: string) => fileURLToPath(new URL(`../web/${p}`, import.meta.url));

// The design catalog: Overhand's own tool, served at overhand.dev/docs/design and never part of a release. It renders
// the dashboard's real components (`@` is apps/web/src) on the demo's sample data, with the dashboard's fonts.
export default defineConfig({
  base: "/docs/design/",
  publicDir: web("public"),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": web("src") }, dedupe: ["react", "react-dom", "@tanstack/react-query"] },
  // every screen and drawer of the dashboard is in it, eagerly: it's a reference, not a first page load
  build: { chunkSizeWarningLimit: 2400 },
  server: { port: 5174 },
});
