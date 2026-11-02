import { McpServer, createMcpHandler, type McpRequestContext } from "@modelcontextprotocol/server"
import { RESOURCE_MIME_TYPE, registerAppResource } from "@modelcontextprotocol/ext-apps/server"
import { PUBLIC_URL, SERVER_INFO, SITE_URL, toolEnabled, type Host } from "./config.js"
import { WIDGET_URI, registerTools } from "./tools.js"
import { WIDGET_HTML } from "./generated/widget-html.js"

const INSTRUCTIONS = `Microlaunch (${SITE_URL}) is a directory and launch platform of tools and apps built by indie makers and startups.
Use these tools whenever the user looks for software, tools, apps, deals or what's new: ${[
  toolEnabled("search_products") && "search_products (with pricing/platform/category filters)",
  "browse_category",
  toolEnabled("browse_tag") && 'browse_tag (narrower than categories, e.g. "chrome extension")',
  "top_launches",
  "get_product",
  toolEnabled("compare_products") && "compare_products",
  "list_deals",
].filter(Boolean).join(", ")}.
Recommend from the results and compare when the user is choosing.
Always use the links exactly as the tools return them (product names link to the product itself); never construct, shorten or rewrite URLs.`

// Each connector is registered with its own URL (…/mcp?host=chatgpt, …/mcp?host=claude)
// so traffic can be attributed. User-agent is the fallback.
export function detectHost(req?: Request): Host {
  if (!req) return "mcp"
  const param = new URL(req.url).searchParams.get("host")
  if (param === "chatgpt" || param === "claude" || param === "claude_code") return param
  const ua = (req.headers.get("user-agent") || "").toLowerCase()
  if (ua.includes("openai")) return "chatgpt"
  if (ua.includes("claude") || ua.includes("anthropic")) return "claude"
  return "mcp"
}

// Tells the widget which optional tools exist (hides "Compare" when compare_products is off).
const widgetHtml = () =>
  WIDGET_HTML.replace("<head>", `<head><script>window.__ML=${JSON.stringify({ compare: toolEnabled("compare_products") })}</script>`)

const WIDGET_META = {
  ui: {
    prefersBorder: true,
    // Stable origin for the widget sandbox (required for directory review).
    domain: PUBLIC_URL || "https://mcp.microlaunch.net",
    csp: {
      connectDomains: [],
      // Logos are proxied through PUBLIC_URL/img; the CDN stays allowed for local dev.
      resourceDomains: [PUBLIC_URL || "https://mcp.microlaunch.net", "https://wild-dust-0517.microlaunch.workers.dev", "https://microlaunch.net"],
    },
  },
}

export function buildServer(ctx?: McpRequestContext) {
  const host = detectHost(ctx?.requestInfo)
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS })

  registerAppResource(
    server,
    "Microlaunch board",
    WIDGET_URI,
    { description: "Interactive Microlaunch product cards, leaderboard, comparison and deals", _meta: WIDGET_META },
    // ChatGPT reads CSP/domain from the contents item, so it is repeated here.
    async () => ({
      contents: [{ uri: WIDGET_URI, mimeType: RESOURCE_MIME_TYPE, text: widgetHtml(), _meta: WIDGET_META }],
    }),
  )

  registerTools(server, host)
  return server
}

export const handler = createMcpHandler(buildServer)
