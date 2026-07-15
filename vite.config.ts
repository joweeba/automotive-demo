import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GLB lives in public/models and is served as a static asset.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, open: true },
});
