import type { Config } from "tailwindcss";
import tidalPreset from "@liquidai/tokens/tailwind";

export default {
  presets: [tidalPreset],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    // ensures Tailwind extracts the class names used inside Tidal components
    "./node_modules/@liquidai/react/dist/**/*.js",
  ],
  darkMode: "class",
} satisfies Config;
