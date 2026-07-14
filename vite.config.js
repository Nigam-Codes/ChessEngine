import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" makes asset URLs relative, so the build works when served from
// a GitHub Pages project site (https://user.github.io/repo/).
export default defineConfig({
  base: "./",
  plugins: [react()],
});
