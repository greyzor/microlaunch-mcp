import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"

// End-to-end check against a running server: lists tools/resources and calls
// every tool once. Usage: MCP_URL=http://localhost:8787/mcp npm run smoke
const url = new URL(process.env.MCP_URL || "http://localhost:8787/mcp?host=chatgpt")
const client = new Client({ name: "smoke", version: "0.0.0" })
await client.connect(new StreamableHTTPClientTransport(url))

const { tools } = await client.listTools()
console.log("tools:", tools.map((t) => `${t.name}${(t._meta as any)?.ui?.resourceUri ? " [ui]" : ""}`).join(", "))
const { resources } = await client.listResources()
for (const r of resources) {
  const read = await client.readResource({ uri: r.uri })
  const c = read.contents[0] as { mimeType?: string; text?: string }
  console.log("resource:", r.uri, c.mimeType, `${((c.text?.length ?? 0) / 1024).toFixed(0)}KB`, JSON.stringify((read.contents[0] as any)._meta ?? (r as any)._meta ?? {}))
}

const calls: Array<[string, Record<string, unknown>]> = [
  ["search_products", { query: "seo", limit: 3 }],
  ["search_products", { query: "invoice", pricing: "free", platform: "web" }],
  ["browse_category", { category: "AI tools" }],
  ["browse_category", { category: "gardening" }],
  ["browse_tag", { tag: "chrome extensions" }],
  ["browse_tag", { tag: "zzz-not-a-tag" }],
  ["compare_products", { products: ["Tag Parrot", "aimd", "nope-xyz-123"] }],
  ["top_launches", { scope: "this_month" }],
  ["top_launches", { scope: "today", category: "dev tools" }],
  ["get_product", { slug: "tagparrot" }],
  ["get_product", { slug: "does-not-exist-xyz" }],
  ["list_deals", { category: "marketing" }],
  ["plan_launch", { product_url: "https://example.com", name: "Example", tagline: "Turn any spreadsheet into a client portal your customers actually log into", category: "productivity", stage: "mvp-ready" }],
]
for (const [name, args] of calls) {
  // Feature-flagged tools (plan_launch, find_alternatives) may be off.
  if (!tools.some((t) => t.name === name)) {
    console.log(`\n=== ${name} skipped (not enabled on this server)`)
    continue
  }
  const t0 = Date.now()
  const res = await client.callTool({ name, arguments: args })
  const text = (res.content as Array<{ text?: string }>)[0]?.text ?? ""
  console.log(`\n=== ${name} ${JSON.stringify(args)} (${Date.now() - t0}ms)${res.isError ? " ERROR" : ""}\n${text.slice(0, 700)}`)
}
await client.close()
