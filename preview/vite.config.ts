import { defineConfig } from "vite"

export default defineConfig({
  root: __dirname,
  server: { port: 5199, proxy: { "/mcp": `http://localhost:${process.env.PORT || 8787}` } },
})
