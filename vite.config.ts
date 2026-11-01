import { defineConfig } from "vite"
import { viteSingleFile } from "vite-plugin-singlefile"

// The widget ships as one self-contained HTML string (MCP Apps resources
// cannot load our own JS/CSS from elsewhere without CSP allowances).
export default defineConfig({
  root: "widget",
  plugins: [viteSingleFile()],
  build: { outDir: "../dist/widget", emptyOutDir: true, target: "es2022" },
})
