import { createServer } from "node:http"
import { toNodeHandler } from "@modelcontextprotocol/node"
import { route } from "./app.js"

// Local Node dev server. Production runs src/worker.ts on Cloudflare.
const port = Number(process.env.PORT || 8787)
const node = toNodeHandler({ fetch: route })

createServer((req, res) => node(req, res)).listen(port, () => console.log(`Microlaunch MCP listening on http://localhost:${port}/mcp`))
