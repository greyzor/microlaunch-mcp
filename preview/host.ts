import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge"

// Minimal MCP Apps host for local widget development (npm run preview).
const PRESETS: Array<[string, Record<string, unknown>]> = [
  ["top_launches", { scope: "this_week" }],
  ["search_products", { query: "seo", limit: 5 }],
  ["search_products", { query: "invoice", pricing: "free", limit: 5 }],
  ["browse_category", { category: "AI tools" }],
  ["compare_products", { products: ["Tag Parrot", "AIMD", "selpo"] }],
  ["get_product", { slug: "incredible" }],
  ["list_deals", {}],
  ["plan_launch", { product_url: "https://example.com", name: "Example", tagline: "Turn any spreadsheet into a client portal your customers actually log into", category: "productivity", stage: "mvp-ready" }],
  ["browse_category", { category: "marketing" }],
  ["top_launches", { scope: "today" }],
  ["browse_tag", { tag: "chrome extension" }],
]
const $ = (id: string) => document.getElementById(id)!
const log = (m: string) => { $("log").textContent = `${m}\n${$("log").textContent}`.slice(0, 4000) }
const select = $("preset") as HTMLSelectElement
PRESETS.forEach(([name, args], i) => select.add(new Option(`${name} ${JSON.stringify(args)}`.slice(0, 90), String(i))))

const client = new Client({ name: "preview-host", version: "0.0.0" })
await client.connect(new StreamableHTTPClientTransport(new URL("/mcp?host=mcp", location.href)))
const { resources } = await client.listResources()
const html = ((await client.readResource({ uri: resources[0].uri })).contents[0] as { text: string }).text
const theme = () => (($("dark") as HTMLInputElement).checked ? "dark" : "light")

async function run(name: string, args: Record<string, unknown>) {
  const wrap = document.createElement("div")
  wrap.className = "frame"
  const iframe = document.createElement("iframe")
  iframe.srcdoc = html
  wrap.append(iframe)
  $("frames").prepend(wrap)
  wrap.style.width = `${($("width") as HTMLInputElement).value}px`

  const bridge = new AppBridge(client, { name: "preview-host", version: "0.0.0" }, { openLinks: {}, serverTools: {}, message: { text: {} }, updateModelContext: { text: {}, structuredContent: {} } })
  bridge.setHostContext({ theme: theme(), displayMode: "inline", platform: "web" })
  bridge.onsizechange = ({ height }) => { if (height) iframe.style.height = `${height}px` }
  bridge.onopenlink = async ({ url }) => { log(`openLink → ${url}`); return {} }
  bridge.onmessage = async ({ content }) => { log(`message → ${JSON.stringify(content)}`); return {} }
  bridge.onupdatemodelcontext = async (params) => { log(`modelContext → ${JSON.stringify(params.content)}`); return {} }
  const result = client.callTool({ name, arguments: args })
  bridge.oninitialized = async () => {
    await bridge.sendToolInput({ arguments: args })
    await bridge.sendToolResult((await result) as never)
  }
  await new Promise((r) => iframe.addEventListener("load", r, { once: true }))
  await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!))
  ;($("dark") as HTMLInputElement).addEventListener("change", () => bridge.sendHostContextChange({ theme: theme() }))
}

$("run").addEventListener("click", () => { const [n, a] = PRESETS[Number(select.value)]; void run(n, a) })
$("dark").addEventListener("change", () => document.body.classList.toggle("dark", theme() === "dark"))
const auto = new URLSearchParams(location.search)
if (auto.has("dark")) { ($("dark") as HTMLInputElement).checked = true; document.body.classList.add("dark") }
if (auto.has("w")) ($("width") as HTMLInputElement).value = auto.get("w")!
for (const i of (auto.get("run") ?? "").split(",").filter(Boolean)) await run(...PRESETS[Number(i)])
