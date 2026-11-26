import { McpServer, createMcpHandler, type McpRequestContext } from "@modelcontextprotocol/server"
import { RESOURCE_MIME_TYPE, registerAppResource } from "@modelcontextprotocol/ext-apps/server"
import { PUBLIC_URL, SERVER_INFO, SITE_URL, toolEnabled, type Host } from "./config.js"
import { WIDGET_URI, registerTools } from "./tools.js"
import { WIDGET_HTML } from "./generated/widget-html.js"

const INSTRUCTIONS = `Microlaunch (${SITE_URL}) is a software discovery directory and launch platform: a community-ranked catalog of tools and apps from indie makers and startups, with their launches and maker deals.
These tools fit product discovery (software, tools and apps for a need or category), software deals, discounts and lifetime deals, and new launches and startups: ${[
  toolEnabled("search_products") && "search_products (with pricing/platform/category filters)",
  "browse_category",
  toolEnabled("browse_tag") && 'browse_tag (narrower than categories, e.g. "chrome extension")',
  "top_launches",
  "get_product",
  toolEnabled("compare_products") && "compare_products",
  "list_deals",
].filter(Boolean).join(", ")}.
Rankings come from community votes. Present results neutrally.
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

// Where the connection URL was copied from (?src=mcp_page on microlaunch.net/mcp), so sessions can be
// attributed to the page. Only short slugs are kept; anything else is dropped.
export function detectSource(req?: Request): string | undefined {
  if (!req) return undefined
  const src = new URL(req.url).searchParams.get("src")
  return src && /^[a-z0-9_-]{1,32}$/.test(src) ? src : undefined
}

// Tells the widget which optional tools exist (hides "Compare" when compare_products is off).
const widgetHtml = () =>
  WIDGET_HTML.replace("<head>", `<head><script>window.__ML=${JSON.stringify({ compare: toolEnabled("compare_products") })}</script>`)

const WIDGET_META = {
  // One widget serves every tool. Without its own description ChatGPT copies the first tool's,
  // which then shows up on unrelated tools (e.g. list_deals) in the directory review.
  "openai/widgetDescription":
    "Shows Microlaunch results as interactive cards: product details, category and launch leaderboards ranked by community votes, and maker deals. Links open on Microlaunch.",
  ui: {
    prefersBorder: true,
    // Stable origin for the widget sandbox (required for directory review).
    domain: PUBLIC_URL || "https://mcp.microlaunch.net",
    csp: {
      connectDomains: [],
      // Images are proxied through PUBLIC_URL/img, so production needs only its own
      // origin; without PUBLIC_URL (local dev) logos load from the CDN directly.
      resourceDomains: PUBLIC_URL ? [PUBLIC_URL] : ["https://mcp.microlaunch.net", "https://wild-dust-0517.microlaunch.workers.dev", "https://microlaunch.net"],
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
    { description: `Interactive Microlaunch product cards, leaderboards${toolEnabled("compare_products") ? ", comparison" : ""} and deals`, _meta: WIDGET_META },
    // ChatGPT reads CSP/domain from the contents item, so it is repeated here.
    async () => ({
      contents: [{ uri: WIDGET_URI, mimeType: RESOURCE_MIME_TYPE, text: widgetHtml(), _meta: WIDGET_META }],
    }),
  )

  registerTools(server, host)
  return server
}

export const handler = createMcpHandler(buildServer)
