import type { McpServer } from "@modelcontextprotocol/server"
import { registerAppTool as registerAppToolRaw } from "@modelcontextprotocol/ext-apps/server"
import { z } from "zod/v4"
import { PLATFORMS, PRICING, findAlternatives, getCategories, getCategoryBest, getCategoryPressure, getDeals, getLeaderboard, getProduct, getTagBest, resolveCategory, resolveTag, searchProducts, type ProductCard } from "./api.js"
import { toolScope, track, trackError } from "./analytics.js"
import { ALPHA_TOOLS, DRAFT_HANDOFF, toolEnabled, ENABLE_ALTERNATIVES, ENABLE_PLAN_LAUNCH, FREE_LAUNCH, LIMITS, SHOW_PRICING, TIERS, type Host } from "./config.js"
import { altPath, categoryPath, tagPath, encodeDraft, productLink, productPath, siteLink, websiteLink } from "./links.js"

export const WIDGET_URI = "ui://microlaunch/board-v6.html"

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } as const

const STAGES = ["idea", "mvp-wip", "mvp-ready", "first-customers", "growing", "established"] as const

type ToolResult = {
  content: Array<{ type: "text"; text: string }>
  structuredContent: Record<string, unknown>
  isError?: boolean
}

function withLinks(items: ProductCard[], host: Host, campaign: string) {
  // `url` is the product's own website (via /go); the Microlaunch page is a separate field.
  return items.map((c) => ({ ...c, url: productLink(c.slug, host, campaign), microlaunch_url: siteLink(productPath(c.slug), host, campaign) }))
}

function bullet(c: ProductCard & { url: string }) {
  const tags = [c.featured ? "Featured" : "", c.category || "", c.votes ? `${c.votes} votes` : ""].filter(Boolean).join(" · ")
  return `- [${c.name}](${c.url})${c.tagline ? ` — ${c.tagline}` : ""}${tags ? ` (${tags})` : ""}`
}

// Every tool runs inside toolScope, so track()/trackError() can add duration_ms.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registerAppTool: typeof registerAppToolRaw = (server: any, name: any, config: any, cb: any) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerAppToolRaw(server, name, config, (...args: any[]) => toolScope.run({ t0: Date.now() }, () => cb(...args)))

function failure(host: Host, tool: string, err: unknown): ToolResult {
  console.error(`[${tool}]`, err)
  trackError(host, tool, err)
  return {
    isError: true,
    content: [{ type: "text", text: "Microlaunch is temporarily unavailable. Try again in a moment." }],
    structuredContent: { view: "error", message: "Microlaunch is temporarily unavailable." },
  }
}

const alphaTitle = (tool: string, title: string) => (ALPHA_TOOLS.has(tool) ? `${title} (alpha)` : title)
const alphaNote = (tool: string) =>
  ALPHA_TOOLS.has(tool) ? "\n(This Microlaunch feature is in alpha: results can miss relevant products; say so if they look off.)" : ""

// Each tool is defined once and registered per request with the calling host,
// so links and analytics are attributed to ChatGPT vs Claude vs other clients.
export function registerTools(server: McpServer, host: Host) {
  const ui = { ui: { resourceUri: WIDGET_URI } }

  if (toolEnabled("search_products"))
  registerAppTool(
    server,
    "search_products",
    {
      title: alphaTitle("search_products", "Find tools on Microlaunch"),
      description:
        "Find software tools and apps made by indie makers and startups for a need, use case or problem (e.g. 'seo audit tool', 'AI meeting notes', 'invoice app for freelancers'). Supports filters for pricing (free, subscription, one-time, lifetime deal), platform (web, mobile, browser extension, desktop…) and category. Use whenever the user is looking for a tool or app recommendation.",
      inputSchema: {
        query: z.string().min(2).max(80).describe("What the user needs, in a few words"),
        pricing: z.enum(PRICING).optional().describe("Only products with this pricing model"),
        platform: z.enum(PLATFORMS).optional().describe("Only products on this platform"),
        category: z.string().max(40).optional().describe("Category name or slug, e.g. ai, marketing, productivity"),
        limit: z.number().int().min(1).max(LIMITS.search).optional().describe(`Max results (≤${LIMITS.search})`),
      },
      annotations: READ_ONLY,
      _meta: { ...ui, "openai/toolInvocation/invoking": "Searching Microlaunch…", "openai/toolInvocation/invoked": "Found products" },
    },
    async ({ query, pricing, platform, category, limit }): Promise<ToolResult> => {
      try {
        const cat = (await resolveCategory(category)).slug
        const res = await searchProducts(query, limit ?? 6, { pricing, platform, category: cat })
        const items = withLinks(res.items, host, "search_products")
        const more = siteLink(cat ? categoryPath(cat) : "/", host, "search_products")
        const filters = [pricing?.replace("_", " "), platform?.replace("_", " "), cat].filter(Boolean).join(", ")
        track(host, "search_products", { query, pricing, platform, category: cat, results: items.length, degraded: res.degraded })
        return {
          content: [{
            type: "text",
            text: items.length
              ? `Top ${items.length} Microlaunch results for "${query}"${filters ? ` (${filters})` : ""} — ${res.total} matches; browse more at ${more}:\n${items.map(bullet).join("\n")}\nOffer to compare the most relevant ones (compare_products) or open one (get_product).${alphaNote("search_products")}`
              : `No Microlaunch products matched "${query}"${filters ? ` with filters ${filters}` : ""}. Try a broader query or fewer filters.`,
          }],
          structuredContent: { view: "products", title: `Results for “${query}”${filters ? ` · ${filters}` : ""}`, total: res.total, items, more_url: more, alpha: ALPHA_TOOLS.has("search_products") },
        }
      } catch (e) {
        return failure(host, "search_products", e)
      }
    },
  )

  registerAppTool(
    server,
    "browse_category",
    {
      title: "Best tools in a category",
      description:
        "List the best-ranked products on Microlaunch in a category (e.g. 'AI', 'marketing', 'dev tools', 'productivity', 'SEO', 'no-code'). Use for 'best X tools' or 'what tools exist for Y' questions. If the category is unknown, the result lists valid categories.",
      inputSchema: { category: z.string().min(2).max(40).describe("Category name or slug") },
      annotations: READ_ONLY,
      _meta: { ...ui, "openai/toolInvocation/invoking": "Browsing the category…", "openai/toolInvocation/invoked": "Category loaded" },
    },
    async ({ category }): Promise<ToolResult> => {
      try {
        const resolved = await resolveCategory(category)
        if (!resolved.slug) {
          const list = resolved.suggestions.map((c) => `${c.label} (${c.slug})`).join(", ")
          return {
            content: [{ type: "text", text: `"${category}" isn't a Microlaunch category. Closest options: ${list}. Pick one${toolEnabled("search_products") ? ", or use search_products for free-text needs" : toolEnabled("browse_tag") ? ", or try browse_tag" : ""}.` }],
            structuredContent: { view: "error", message: `No category “${category}”. Try: ${resolved.suggestions.slice(0, 6).map((c) => c.label).join(", ")}` },
          }
        }
        const res = await getCategoryBest(resolved.slug)
        const items = withLinks(res.items, host, "browse_category")
        const more = siteLink(categoryPath(resolved.slug), host, "browse_category")
        track(host, "browse_category", { category: resolved.slug, results: items.length })
        return {
          content: [{
            type: "text",
            text: items.length
              ? `Best-ranked ${resolved.slug} products on Microlaunch (${res.total} in category; full list: ${more}):\n${items.map((c) => bullet(c).replace("- ", `${c.rank}. `)).join("\n")}`
              : `No products in ${resolved.slug} yet.`,
          }],
          structuredContent: { view: "leaderboard", title: `Best in ${resolved.slug}`, total: res.total, items, more_url: more },
        }
      } catch (e) {
        return failure(host, "browse_category", e)
      }
    },
  )

  if (toolEnabled("browse_tag"))
  registerAppTool(
    server,
    "browse_tag",
    {
      title: "Best tools with a tag",
      description:
        "List the best-ranked Microlaunch products with a tag. Tags are narrower than categories (e.g. 'chrome extension', 'lead generation', 'shopify', 'ai agents', 'macos', 'open source'). Use when the need is more specific than a category. If the tag is unknown, the result lists close tags.",
      inputSchema: { tag: z.string().min(2).max(60).describe("Tag name or slug, e.g. 'chrome extension'") },
      annotations: READ_ONLY,
      _meta: { ...ui, "openai/toolInvocation/invoking": "Browsing the tag…", "openai/toolInvocation/invoked": "Tag loaded" },
    },
    async ({ tag }): Promise<ToolResult> => {
      try {
        const resolved = await resolveTag(tag)
        if (!resolved.tag) {
          const list = resolved.suggestions.map((t) => `${t.label} (${t.slug})`).join(", ")
          return {
            content: [{ type: "text", text: `"${tag}" isn't a Microlaunch tag. Closest tags: ${list}. Pick one, or use browse_category${toolEnabled("search_products") ? " / search_products" : ""}.` }],
            structuredContent: { view: "error", message: `No tag “${tag}”. Try: ${resolved.suggestions.slice(0, 6).map((t) => t.label).join(", ")}` },
          }
        }
        const { slug, label } = resolved.tag
        const res = await getTagBest(slug)
        const items = withLinks(res.items, host, "browse_tag")
        const more = siteLink(tagPath(slug), host, "browse_tag")
        track(host, "browse_tag", { tag: slug, results: items.length })
        return {
          content: [{
            type: "text",
            text: items.length
              ? `Best-ranked Microlaunch products tagged "${label}" (${res.total} with this tag; full list: ${more}):\n${items.map((c) => bullet(c).replace("- ", `${c.rank}. `)).join("\n")}`
              : `No products tagged "${label}" yet.`,
          }],
          structuredContent: { view: "leaderboard", title: `Best tagged ${label}`, total: res.total, items, more_url: more },
        }
      } catch (e) {
        return failure(host, "browse_tag", e)
      }
    },
  )

  registerAppTool(
    server,
    "top_launches",
    {
      title: "Top launches on Microlaunch",
      description:
        "Get the current Microlaunch leaderboard: top-ranked launches from today, the last 7 days or the last 30 days, optionally filtered by category slug (e.g. ai, marketing, dev-tools, productivity, seo). Use for 'what's new/trending in indie products' questions.",
      inputSchema: {
        scope: z.enum(["today", "this_week", "this_month"]).optional().describe("Defaults to this_week"),
        category: z.string().max(40).optional().describe("Category name or slug, e.g. ai, marketing, dev tools"),
      },
      annotations: READ_ONLY,
      _meta: { ...ui, "openai/toolInvocation/invoking": "Loading the leaderboard…", "openai/toolInvocation/invoked": "Leaderboard ready" },
    },
    async ({ scope, category }): Promise<ToolResult> => {
      try {
        const cat = (await resolveCategory(category)).slug
        const res = await getLeaderboard({ scope: scope ?? "this_week", category: cat })
        const items = withLinks(res.items, host, "top_launches")
        const full = siteLink(cat ? categoryPath(cat) : "/", host, "top_launches")
        const label = { today: "Today's top launches", this_week: "Top launches this week", this_month: "Top launches (last 30 days)" }[res.scope]
        track(host, "top_launches", { scope: res.scope, category: cat, results: items.length })
        return {
          content: [{
            type: "text",
            text: items.length
              ? `${label}${cat ? ` in ${cat}` : ""} on Microlaunch (${res.total_in_scope} live; full leaderboard: ${full}):\n${items.map((c) => bullet(c).replace("- ", `${c.rank}. `)).join("\n")}${res.widened ? `\n(Few launches in the requested window — widened to ${res.scope.replace("_", " ")}.)` : ""}`
              : `No live launches${cat ? ` in "${cat}"` : ""} right now.`,
          }],
          structuredContent: { view: "leaderboard", title: `${label}${cat ? ` · ${cat}` : ""}`, total: res.total_in_scope, items, more_url: full },
        }
      } catch (e) {
        return failure(host, "top_launches", e)
      }
    },
  )

  registerAppTool(
    server,
    "get_product",
    {
      title: "Microlaunch product details",
      description:
        `Get details for one Microlaunch product by its slug (from ${toolEnabled("browse_tag") ? "browse_category, browse_tag" : "browse_category"} or top_launches results): description, category, stage, votes, reviews count and awards.`,
      inputSchema: { slug: z.string().min(1).max(100).describe("Product slug, e.g. 'tagparrot'") },
      annotations: READ_ONLY,
      _meta: { ...ui, "openai/toolInvocation/invoking": "Opening product…", "openai/toolInvocation/invoked": "Product loaded" },
    },
    async ({ slug }): Promise<ToolResult> => {
      try {
        const p = await getProduct(slug)
        track(host, "get_product", { slug, found: Boolean(p) })
        if (!p) {
          return {
            content: [{ type: "text", text: `No Microlaunch product with slug "${slug}". ${toolEnabled("search_products") ? "Use search_products" : toolEnabled("browse_tag") ? "Use browse_category or browse_tag" : "Use browse_category or top_launches"} to find the right slug.` }],
            structuredContent: { view: "error", message: `No product “${slug}” on Microlaunch.` },
          }
        }
        const microlaunchUrl = siteLink(productPath(p.slug), host, "get_product")
        const url = websiteLink(p.website, host, "get_product", p.slug) ?? microlaunchUrl
        const lines = [
          `**[${p.name}](${url})** — ${p.tagline}`,
          p.description || "",
          [p.category && `Category: ${p.category}`, p.stage && `Stage: ${p.stage}`, p.pricing_model && `Pricing: ${p.pricing_model}`].filter(Boolean).join(" · "),
          `${p.votes_all_time} votes · ${p.reviews} reviews${p.awards.length ? ` · ${p.awards.join(", ")}` : ""}`,
          `Reviews and screenshots on Microlaunch: ${microlaunchUrl}`,
        ]
        return {
          content: [{ type: "text", text: lines.filter(Boolean).join("\n") }],
          structuredContent: { view: "product", product: { ...p, website: undefined, url, microlaunch_url: microlaunchUrl } },
        }
      } catch (e) {
        return failure(host, "get_product", e)
      }
    },
  )

  if (toolEnabled("compare_products"))
  registerAppTool(
    server,
    "compare_products",
    {
      title: alphaTitle("compare_products", "Compare Microlaunch products"),
      description:
        "Compare 2–4 Microlaunch products side by side (pricing model, category, stage, votes, reviews, awards). Accepts product names or slugs, so call it directly — no need to search first. Use when the user is choosing between tools.",
      inputSchema: { products: z.array(z.string().min(1).max(100)).min(2).max(4).describe("Product names or slugs, e.g. ['Tag Parrot', 'aimd']") },
      annotations: READ_ONLY,
      _meta: { ...ui, "openai/toolInvocation/invoking": "Comparing…", "openai/toolInvocation/invoked": "Comparison ready" },
    },
    async ({ products }): Promise<ToolResult> => {
      try {
        const unique = [...new Set(products.map((x) => x.trim()).filter(Boolean))].slice(0, 4)
        // Exact slug first, then the best name match from search.
        // Search always returns *something*; only accept a hit whose name matches.
        const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "")
        const sameName = (a: string, b: string) => norm(a) === norm(b) || (norm(a).length > 3 && (norm(a).includes(norm(b)) || norm(b).includes(norm(a))))
        const resolve = async (q: string) =>
          (await getProduct(q).catch(() => null)) ??
          (await searchProducts(q, 3)
            .then((r) => r.items.find((i) => sameName(i.name, q)))
            .then((hit) => (hit ? getProduct(hit.slug) : null))
            .catch(() => null))
        const resolved = await Promise.all(unique.map(async (q) => ({ q, p: await resolve(q) })))
        const seen = new Set<string>()
        const found = resolved
          .map((r) => r.p)
          .filter((p): p is NonNullable<typeof p> => Boolean(p) && !seen.has(p!.slug) && Boolean(seen.add(p!.slug)))
          .map((p) => ({
            ...p,
            url: websiteLink(p.website, host, "compare_products", p.slug) ?? siteLink(productPath(p.slug), host, "compare_products"),
            website: undefined,
            microlaunch_url: siteLink(productPath(p.slug), host, "compare_products"),
          }))
        const missing = resolved.filter((r) => !r.p).map((r) => r.q)
        track(host, "compare_products", { count: found.length, missing: missing.length })
        if (found.length < 2) {
          return {
            content: [{ type: "text", text: `Need at least two valid Microlaunch products to compare${missing.length ? ` (not found: ${missing.join(", ")})` : ""}. Use search_products to get slugs.` }],
            structuredContent: { view: "error", message: "Pick at least two products to compare." },
          }
        }
        const row = (p: (typeof found)[number]) =>
          `| [${p.name}](${p.url}) | ${p.tagline} | ${p.pricing_model ?? "—"} | ${p.category ?? "—"} | ${p.stage ?? "—"} | ${p.votes_all_time} | ${p.reviews} | ${p.awards.join(", ") || "—"} |`
        return {
          content: [{
            type: "text",
            text: [
              "| Product | What it does | Pricing | Category | Stage | Votes | Reviews | Awards |",
              "|---|---|---|---|---|---|---|---|",
              ...found.map(row),
              missing.length ? `\nNot found: ${missing.join(", ")}.` : "",
              "Descriptions:",
              ...found.map((p) => `- ${p.name}: ${p.description ?? p.tagline}`),
              alphaNote("compare_products"),
            ].filter(Boolean).join("\n"),
          }],
          structuredContent: { view: "compare", title: `Comparing ${found.map((p) => p.name).join(" vs ")}`, items: found, alpha: ALPHA_TOOLS.has("compare_products") },
        }
      } catch (e) {
        return failure(host, "compare_products", e)
      }
    },
  )

  if (ENABLE_ALTERNATIVES) registerFindAlternatives(server, host)

  registerAppTool(
    server,
    "list_deals",
    {
      title: "Maker deals on Microlaunch",
      description:
        "List active discounts and lifetime deals from indie makers on Microlaunch, optionally by category slug. Codes are revealed on Microlaunch, not here.",
      inputSchema: { category: z.string().max(40).optional().describe("Category name or slug, e.g. ai, marketing") },
      annotations: READ_ONLY,
      _meta: { ...ui, "openai/toolInvocation/invoking": "Loading deals…", "openai/toolInvocation/invoked": "Deals loaded" },
    },
    async ({ category }): Promise<ToolResult> => {
      try {
        const cat = (await resolveCategory(category)).slug
        const res = await getDeals(cat)
        const items = res.items.map(({ deal_url, ...d }) => ({
          ...d,
          url: websiteLink(deal_url, host, "list_deals", d.product.slug) ?? productLink(d.product.slug, host, "list_deals"),
          microlaunch_url: siteLink(productPath(d.product.slug), host, "list_deals"),
        }))
        track(host, "list_deals", { category: cat, results: items.length })
        return {
          content: [{
            type: "text",
            text: items.length
              ? `${res.total} active maker deals${cat ? ` in ${cat}` : ""}. Each name links to the deal; coupon codes are on the product's Microlaunch page:\n${items.map((d) => `- [${d.product.name}](${d.url}) — ${d.title}${d.value ? ` (${d.value})` : ""} · ${d.type}${d.type === "coupon" ? ` · [get the code](${d.microlaunch_url})` : ""}`).join("\n")}`
              : `No active deals${cat ? ` in "${cat}"` : ""} right now.`,
          }],
          structuredContent: { view: "deals", title: `Maker deals${cat ? ` · ${cat}` : ""}`, total: res.total, items },
        }
      } catch (e) {
        return failure(host, "list_deals", e)
      }
    },
  )

  if (!ENABLE_PLAN_LAUNCH) return

  registerAppTool(
    server,
    "plan_launch",
    {
      title: "Plan a Microlaunch launch",
      description:
        "Only for makers/founders who want to launch their own product (not for people looking for tools): check a product's launch readiness on Microlaunch, see how crowded its category is this month and get a link to launch on Microlaunch. After calling, help the user fix any 'warn'/'fail' checks (e.g. rewrite the tagline) before they continue.",
      inputSchema: {
        product_url: z.string().url().max(300).describe("Product website URL"),
        name: z.string().max(60).optional(),
        tagline: z.string().max(200).optional().describe("One-line value proposition"),
        description: z.string().max(2000).optional(),
        category: z.string().max(40).optional().describe("Category slug, e.g. ai, marketing, dev-tools, productivity"),
        stage: z.enum(STAGES).optional(),
        has_revenue: z.boolean().optional().describe("Whether the product already has paying customers"),
      },
      annotations: { ...READ_ONLY, openWorldHint: false },
      _meta: { ...ui, "openai/toolInvocation/invoking": "Planning your launch…", "openai/toolInvocation/invoked": "Launch plan ready" },
    },
    async (args): Promise<ToolResult> => {
      try {
        const url = new URL(args.product_url)
        const name = args.name?.trim() || url.hostname.replace(/^www\./, "").split(".")[0]
        const tagline = args.tagline?.trim() || ""
        const description = args.description?.trim() || ""
        const category = args.category?.trim().toLowerCase() || undefined

        const [categories, pressure, existing, similar] = await Promise.all([
          getCategories(),
          getCategoryPressure(category),
          searchProducts(name, 3).catch(() => ({ items: [] as ProductCard[], total: 0 })),
          tagline ? searchProducts(tagline.split(/\s+/).slice(0, 4).join(" "), 3).catch(() => ({ items: [] as ProductCard[], total: 0 })) : Promise.resolve({ items: [] as ProductCard[], total: 0 }),
        ])
        const categoryKnown = category ? categories.some((c) => c.slug === category) : false
        const alreadyListed = existing.items.find((p) => p.name.toLowerCase() === name.toLowerCase())

        type Check = { id: string; label: string; status: "pass" | "warn" | "fail" | "info"; tip: string }
        const checks: Check[] = [
          !tagline
            ? { id: "tagline", label: "Tagline", status: "fail", tip: "Add a one-line value proposition (≤70 chars) — it's what shows on the leaderboard." }
            : tagline.length > 70
              ? { id: "tagline", label: "Tagline", status: "warn", tip: `Tagline is ${tagline.length} chars; cards truncate after ~70. Lead with the outcome.` }
              : { id: "tagline", label: "Tagline", status: "pass", tip: "Fits the leaderboard card." },
          !description
            ? { id: "description", label: "Description", status: "fail", tip: "Add 2–4 sentences: who it's for, the problem, what's different." }
            : description.length < 120
              ? { id: "description", label: "Description", status: "warn", tip: "Description is short; aim for 120–600 chars so the product page and SEO pages have substance." }
              : { id: "description", label: "Description", status: "pass", tip: "Good length." },
          !category
            ? { id: "category", label: "Category", status: "warn", tip: "Pick a category so you compete in the right leaderboard." }
            : categoryKnown
              ? { id: "category", label: "Category", status: "pass", tip: `Competes in ${category}.` }
              : { id: "category", label: "Category", status: "warn", tip: `"${category}" isn't a Microlaunch category. Options include: ${categories.filter((c) => c.slug.includes(category.slice(0, 3))).slice(0, 5).map((c) => c.slug).join(", ") || categories.slice(0, 8).map((c) => c.slug).join(", ")}.` },
          url.protocol === "https:"
            ? { id: "url", label: "Website", status: "pass", tip: "Served over HTTPS." }
            : { id: "url", label: "Website", status: "warn", tip: "Serve the site over HTTPS before launching." },
          ...(alreadyListed
            ? [{ id: "existing", label: "Existing listing", status: "info" as const, tip: `"${alreadyListed.name}" is already on Microlaunch — this would be a relaunch of /p/${alreadyListed.slug}.` }]
            : []),
        ]

        const growing = args.has_revenue || args.stage === "growing" || args.stage === "established"
        const recommended = growing ? "launch-plus" : "launch-pro"
        const options = !SHOW_PRICING ? [] : [
          { id: "free", name: FREE_LAUNCH.name, price_usd: 0, includes: [FREE_LAUNCH.note], recommended: false },
          ...TIERS.map((t) => ({ id: t.id, name: t.name, price_usd: t.price_usd, best_for: t.best_for, includes: [...t.includes], recommended: t.id === recommended })),
        ]
        const reason = growing
          ? "You already have traction: Launch Plus adds automated boosts plus X and Reddit distribution to reach buyers beyond Microlaunch."
          : "At this stage the biggest wins are launching on your own date, featured placement and SEO backlinks — that's Launch Pro."

        const draft = encodeDraft({
          v: 1,
          src: host,
          url: url.toString(),
          codename: name,
          problem_label: tagline,
          description,
          market: category && categoryKnown ? category : "",
          stage: args.stage || "",
        })
        // The prefilled hand-off needs plugins/patches/launchpad-draft-handoff.patch on the site.
        const continueUrl = siteLink("/premium", host, "plan_launch", DRAFT_HANDOFF ? { ml_draft: draft } : {})
        const blockers = checks.filter((c) => c.status === "fail").length
        const warnings = checks.filter((c) => c.status === "warn").length

        track(host, "plan_launch", { category, stage: args.stage, recommended, blockers, warnings, relaunch: Boolean(alreadyListed) })

        const plan = {
          product: { name, url: url.toString(), tagline, category: category || null, stage: args.stage || null },
          readiness: { score: Math.round((checks.filter((c) => c.status === "pass").length / checks.filter((c) => c.status !== "info").length) * 100), checks },
          market: { ...pressure, category: category || null, similar_products: withLinks(similar.items, host, "plan_launch") },
          options,
          recommendation: SHOW_PRICING ? { tier: recommended, reason } : null,
          continue_url: continueUrl,
        }
        return {
          content: [{
            type: "text",
            text: [
              `Launch plan for ${name}: readiness ${plan.readiness.score}% (${blockers} blockers, ${warnings} warnings).`,
              ...checks.filter((c) => c.status !== "pass").map((c) => `- ${c.label} [${c.status}]: ${c.tip}`),
              category ? `Category "${category}": ${pressure.live_in_category} launches in the last 30 days (${pressure.live_last_30_days} overall).` : "",
              SHOW_PRICING ? `Options: free (queue, 2–3+ months wait) · Launch Pro $${TIERS[0].price_usd} · Launch Plus $${TIERS[1].price_usd}. Recommended: ${recommended} — ${reason}` : "",
              `Launch options and details on Microlaunch${DRAFT_HANDOFF ? " (details prefilled)" : ""}: ${continueUrl}`,
            ].filter(Boolean).join("\n"),
          }],
          structuredContent: { view: "launch_plan", plan },
        }
      } catch (e) {
        return failure(host, "plan_launch", e)
      }
    },
  )
}

// Disabled via ENABLE_ALTERNATIVES until alternatives search is fixed.
function registerFindAlternatives(server: McpServer, host: Host) {
  const ui = { ui: { resourceUri: WIDGET_URI } }

  registerAppTool(
    server,
    "find_alternatives",
    {
      title: "Find indie alternatives",
      description:
        "Find indie/startup alternatives on Microlaunch to a well-known product or tool (e.g. 'Notion', 'Calendly', 'Ahrefs'). Use when the user asks for alternatives, competitors or cheaper options.",
      inputSchema: { to: z.string().min(2).max(80).describe("Name of the product to find alternatives to") },
      annotations: READ_ONLY,
      _meta: { ...ui, "openai/toolInvocation/invoking": "Finding alternatives…", "openai/toolInvocation/invoked": "Alternatives found" },
    },
    async ({ to }): Promise<ToolResult> => {
      try {
        const res = await findAlternatives(to)
        const items = withLinks(res.items, host, "find_alternatives")
        const more = res.reference ? siteLink(altPath(res.reference.slug), host, "find_alternatives") : siteLink("/", host, "find_alternatives")
        track(host, "find_alternatives", { to, results: items.length })
        return {
          content: [{
            type: "text",
            text: items.length
              ? `Indie alternatives to ${res.reference?.name || to} on Microlaunch (full comparison: ${more}):\n${items.map(bullet).join("\n")}`
              : `Microlaunch has no alternatives indexed for "${to}". Don't run more searches for this; instead call browse_category with the closest category (e.g. productivity, marketing, ai, dev-tools) and pick relevant products from it.`,
          }],
          structuredContent: { view: "products", title: `Alternatives to ${res.reference?.name || to}`, total: items.length, items, more_url: more },
        }
      } catch (e) {
        return failure(host, "find_alternatives", e)
      }
    },
  )
}
