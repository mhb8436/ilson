import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react()],
  resolve: { conditions: ["source"] },
  build: { outDir: "../../dist/renderer", emptyOutDir: true, sourcemap: false },
});
