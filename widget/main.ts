import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps"

// Types mirror the structuredContent emitted by src/tools.ts.
type Card = {
  slug: string; name: string; tagline: string; category: string | null; logo: string | null
  stage: string | null; pricing_model: string | null; featured: boolean; votes?: number; rank?: number
  url: string // the product's own website (via /go)
  microlaunch_url: string
}
type Product = Card & {
  description: string | null; votes_all_time: number; reviews: number; awards: string[]
}
type Deal = { product: Card; title: string; type: string; value: string | null; featured: boolean; url: string; microlaunch_url: string }
type Check = { id: string; label: string; status: "pass" | "warn" | "fail" | "info"; tip: string }
type Plan = {
  product: { name: string; url: string; tagline: string; category: string | null }
  readiness: { score: number; checks: Check[] }
  market: { live_last_30_days: number; live_in_category: number; category: string | null; category_leaders: string[] }
  options: Array<{ id: string; name: string; price_usd: number; includes: string[]; recommended: boolean }>
  recommendation: { tier: string; reason: string } | null
  continue_url: string
}
type View =
  | { view: "products" | "leaderboard"; title: string; total: number; items: Card[]; more_url?: string; alpha?: boolean }
  | { view: "product"; product: Product }
  | { view: "deals"; title: string; total: number; items: Deal[] }
  | { view: "compare"; title: string; items: Product[]; alpha?: boolean }
  | { view: "launch_plan"; plan: Plan }
  | { view: "error"; message: string }

const root = document.getElementById("root")!
const app = new App({ name: "Microlaunch", version: "0.1.0" }, {})
let previous: View | null = null

// --- tiny DOM helper (textContent only; never innerHTML with API data) -----
type Child = Node | string | null | undefined | false
function h(tag: string, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener)
    else if (k === "class") el.className = String(v)
    else if (k === "style") el.setAttribute("style", String(v))
    else el.setAttribute(k, String(v))
  }
  for (const c of children) if (c) el.append(c)
  return el
}

const open = (url: string) => { void app.openLink({ url }) }

function hue(s: string) { let x = 0; for (const ch of s) x = (x * 31 + ch.charCodeAt(0)) % 360; return x }
function logo(c: { name: string; logo: string | null }, size = "") {
  const fallback = () => h("div", { class: `logo ${size}`, style: `background:hsl(${hue(c.name)} 55% 52%)`, "aria-hidden": "true" }, c.name.slice(0, 1).toUpperCase())
  if (!c.logo) return fallback()
  const img = h("img", { class: `logo ${size}`, src: c.logo, alt: "", decoding: "async" }) as HTMLImageElement
  img.addEventListener("error", () => img.replaceWith(fallback()), { once: true })
  return img
}
const brand = () => h("span", { class: "brand" }, "on ", h("b", {}, "Microlaunch"))

// --- shortlist ---------------------------------------------------------------
// Persisted per sandbox origin when storage is available, and mirrored into the
// model's context so "compare my shortlist" works in plain conversation too.
type Pick = { slug: string; name: string }
const SHORTLIST_KEY = "microlaunch:shortlist:v1"
const MAX_PICKS = 4
let shortlist: Pick[] = (() => {
  try { return (JSON.parse(localStorage.getItem(SHORTLIST_KEY) || "[]") as Pick[]).slice(0, MAX_PICKS) } catch { return [] }
})()
const isPicked = (slug: string) => shortlist.some((p) => p.slug === slug)

function setShortlist(next: Pick[]) {
  shortlist = next.slice(-MAX_PICKS)
  try { localStorage.setItem(SHORTLIST_KEY, JSON.stringify(shortlist)) } catch { /* storage blocked */ }
  if (app.getHostCapabilities()?.updateModelContext) {
    void app.updateModelContext({
      content: [{ type: "text", text: shortlist.length ? `User's Microlaunch shortlist: ${shortlist.map((p) => `${p.name} (slug: ${p.slug})`).join(", ")}.` : "User's Microlaunch shortlist is empty." }],
      structuredContent: { shortlist },
    }).catch(() => {})
  }
  document.querySelectorAll<HTMLElement>("[data-star]").forEach((el) => syncStar(el))
  const bar = document.getElementById("shortlist-bar")
  if (bar) bar.replaceWith(shortlistBar())
}

function syncStar(el: HTMLElement) {
  const on = isPicked(el.dataset.star!)
  el.classList.toggle("on", on)
  el.setAttribute("aria-pressed", String(on))
  el.textContent = on ? "★" : "☆"
}

function star(c: Pick) {
  const el = h("button", { class: "star", "data-star": c.slug, title: "Shortlist", "aria-label": `Shortlist ${c.name}` })
  el.addEventListener("click", (e) => {
    e.stopPropagation()
    setShortlist(isPicked(c.slug) ? shortlist.filter((p) => p.slug !== c.slug) : [...shortlist, { slug: c.slug, name: c.name }])
  })
  syncStar(el)
  return el
}

const canCompare = (window as unknown as { __ML?: { compare?: boolean } }).__ML?.compare !== false

function shortlistBar() {
  if (!shortlist.length) return h("div", { id: "shortlist-bar", hidden: true })
  return h("div", { id: "shortlist-bar", class: "shortbar" },
    h("span", {}, h("b", {}, `★ ${shortlist.length}`), ` ${shortlist.map((p) => p.name).join(", ")}`),
    h("span", { class: "actions" },
      h("button", { class: "link", onclick: () => setShortlist([]) }, "Clear"),
      !canCompare ? null : h("button", { class: "btn sm primary", disabled: shortlist.length < 2, onclick: () => void compare(shortlist.map((p) => p.slug)) }, shortlist.length < 2 ? "Pick 2 to compare" : `Compare ${shortlist.length}`),
    ),
  )
}

async function compare(slugs: string[]) {
  root.setAttribute("aria-busy", "true")
  try {
    const res = await app.callServerTool({ name: "compare_products", arguments: { products: slugs } })
    const sc = res.structuredContent as View | undefined
    if (sc) render(sc, true)
  } finally {
    root.removeAttribute("aria-busy")
  }
}

const canAsk = () => Boolean(app.getHostCapabilities()?.message)
function ask(text: string) {
  void app.sendMessage({ role: "user", content: [{ type: "text", text }] }).catch(() => {})
}

// --- views ------------------------------------------------------------------
function productRow(c: Card, ranked: boolean) {
  const go = () => void showProduct(c.slug, c.url)
  return h("div", {
    class: `row ${ranked ? "" : "no-rank"}`, role: "button", tabindex: 0, title: `See ${c.name}`,
    onclick: go, onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go() } },
  },
    ranked ? h("span", { class: "rank" }, String(c.rank ?? "")) : null,
    logo(c),
    h("div", { class: "info" },
      h("div", { class: "name" }, h("span", {}, c.name), c.featured ? h("span", { class: "badge" }, "Featured") : null),
      h("div", { class: "tagline" }, c.tagline),
      h("div", { class: "chips" }, c.category && h("span", { class: "chip" }, c.category), c.pricing_model && h("span", { class: "chip" }, c.pricing_model)),
    ),
    h("div", { class: "side" },
      star(c),
      typeof c.votes === "number" && c.votes > 0 ? h("div", { class: "votes" }, String(c.votes), h("small", {}, "votes")) : null,
    ),
  )
}

const alphaChip = () => h("span", { class: "alpha", title: "Early version: results can miss relevant products" }, "Alpha")

function renderList(v: Extract<View, { view: "products" | "leaderboard" }>) {
  if (!v.items.length) return h("div", { class: "empty" }, "Nothing found on Microlaunch.")
  return h("div", {},
    h("div", { class: "head" }, h("h2", {}, v.title, v.alpha ? alphaChip() : null), brand()),
    h("div", { class: "list" }, ...v.items.map((c) => productRow(c, v.view === "leaderboard"))),
    v.more_url ? h("div", { class: "foot" },
      h("span", { class: "brand" }, `${v.items.length} of ${v.total}`),
      h("button", { class: "btn sm", onclick: () => open(v.more_url!) }, "See all on Microlaunch ↗"),
    ) : null,
  )
}

function renderProduct(p: Product, withBack: boolean) {
  return h("div", {},
    withBack ? h("button", { class: "link back", onclick: () => previous && render(previous) }, "← Back") : null,
    h("div", { class: "detail" },
      h("div", { class: "detail-top" },
        logo(p, "lg"),
        h("div", { class: "info" },
          h("div", { class: "name" }, h("h3", {}, p.name), p.featured ? h("span", { class: "badge" }, "Featured") : null, star(p)),
          h("p", {}, p.tagline),
        ),
      ),
      p.description ? h("p", {}, p.description) : null,
      h("div", { class: "stats" },
        h("div", { class: "stat" }, h("b", {}, String(p.votes_all_time)), h("span", {}, "votes")),
        h("div", { class: "stat" }, h("b", {}, String(p.reviews)), h("span", {}, "reviews")),
        h("div", { class: "stat" }, h("b", {}, p.awards.length ? String(p.awards.length) : "—"), h("span", {}, "awards")),
      ),
      h("div", { class: "chips" }, ...[p.category, p.stage, p.pricing_model, ...p.awards].filter(Boolean).map((t) => h("span", { class: "chip" }, String(t)))),
      h("div", { class: "actions" },
        h("button", { class: "btn primary", onclick: () => open(p.url) }, `Visit ${p.name} ↗`),
        h("button", { class: "btn", onclick: () => open(p.microlaunch_url) }, "Reviews on Microlaunch ↗"),
        canAsk() ? h("button", { class: "btn", onclick: () => ask(`Is ${p.name} (Microlaunch slug: ${p.slug}) a good fit for me? Summarize who it's for, and compare it with 2 similar products on Microlaunch.`) }, "Ask in chat") : null,
      ),
    ),
  )
}

function renderDeals(v: Extract<View, { view: "deals" }>) {
  if (!v.items.length) return h("div", { class: "empty" }, "No active deals right now.")
  return h("div", {},
    h("div", { class: "head" }, h("h2", {}, v.title), brand()),
    h("div", { class: "list" }, ...v.items.map((d) =>
      h("div", { class: "row no-rank" },
        logo(d.product),
        h("div", { class: "info" },
          h("div", { class: "name" }, h("span", {}, d.product.name), d.featured ? h("span", { class: "badge" }, "Featured") : null),
          h("div", { class: "tagline" }, d.title),
          h("div", { class: "chips" }, h("span", { class: "chip" }, d.type), d.value && h("span", { class: "chip" }, d.value)),
        ),
        h("div", { class: "side" },
          h("button", { class: "btn sm primary", onclick: () => open(d.url) }, "Get deal ↗"),
          d.type === "coupon" ? h("button", { class: "link", onclick: () => open(d.microlaunch_url) }, "Code") : null,
        ),
      ),
    )),
    h("div", { class: "foot" }, h("span", { class: "brand" }, `${v.items.length} of ${v.total} deals · coupon codes on Microlaunch`)),
  )
}

function renderCompare(v: Extract<View, { view: "compare" }>) {
  const rows: Array<[string, (p: Product) => string]> = [
    ["What it does", (p) => p.tagline],
    ["Pricing", (p) => p.pricing_model ?? "—"],
    ["Category", (p) => p.category ?? "—"],
    ["Stage", (p) => p.stage ?? "—"],
    ["Votes", (p) => String(p.votes_all_time)],
    ["Reviews", (p) => String(p.reviews)],
    ["Awards", (p) => p.awards.join(", ") || "—"],
  ]
  return h("div", {},
    h("div", { class: "head" }, h("h2", {}, "Side-by-side", v.alpha ? alphaChip() : null), brand()),
    h("div", { class: "cmp-wrap" },
      h("table", { class: "cmp" },
        h("thead", {}, h("tr", {}, h("th", {}),
          ...v.items.map((p) => h("th", {},
            h("div", { class: "cmp-head" }, logo(p), h("span", {}, p.name), p.featured ? h("span", { class: "badge" }, "Featured") : null),
          )),
        )),
        h("tbody", {},
          ...rows.map(([label, get]) => h("tr", {}, h("th", { scope: "row" }, label), ...v.items.map((p) => h("td", {}, get(p))))),
          h("tr", {}, h("th", {}), ...v.items.map((p) => h("td", {}, h("button", { class: "btn sm primary", onclick: () => open(p.url) }, "View ↗")))),
        ),
      ),
    ),
    canAsk() ? h("div", { class: "foot" },
      h("span", { class: "brand" }, "Not sure which one?"),
      h("button", { class: "btn sm", onclick: () => ask(`Help me choose between ${v.items.map((p) => p.name).join(", ")} from Microlaunch. Ask me what matters most, then recommend one.`) }, "Help me choose"),
    ) : null,
  )
}

const ICONS = { pass: "✓", warn: "!", fail: "✕", info: "i" } as const

function renderPlan(plan: Plan) {
  const m = plan.market
  return h("div", { class: "detail" },
    h("div", { class: "head" }, h("h2", {}, `Launch plan · ${plan.product.name}`), brand()),
    h("div", { class: "score" },
      h("div", { class: "ring", style: `--p:${plan.readiness.score}` }, h("b", {}, `${plan.readiness.score}%`)),
      h("ul", { class: "checks" }, ...plan.readiness.checks.map((c) =>
        h("li", { class: c.status }, h("span", { class: "ic", "aria-label": c.status }, ICONS[c.status]), h("span", {}, h("b", {}, `${c.label} `), h("em", {}, c.tip))),
      )),
    ),
    m.category ? h("div", { class: "pressure" },
      `${m.live_in_category} launches in ${m.category} over the last 30 days`,
      m.category_leaders.length ? ` · leading: ${m.category_leaders.join(", ")}` : "",
    ) : null,
    plan.options.length ? h("div", { class: "section-title" }, "Launch options") : null,
    !plan.options.length ? null : h("div", { class: "tiers" }, ...plan.options.map((o) =>
      h("div", { class: `tier ${o.recommended ? "rec" : ""}` },
        h("div", { class: "name" }, h("span", {}, o.name), o.recommended ? h("span", { class: "badge" }, "Recommended") : null),
        h("div", { class: "price" }, o.price_usd ? `$${o.price_usd}` : "Free"),
        h("ul", {}, ...o.includes.slice(0, 5).map((t) => h("li", {}, t))),
      ),
    )),
    plan.recommendation ? h("p", { class: "pressure" }, plan.recommendation.reason) : null,
    h("div", { class: "actions" },
      h("button", { class: "btn primary", onclick: () => open(plan.continue_url) }, "Launch on Microlaunch ↗"),
    ),
  )
}

function render(v: View, withBack = false) {
  let node: HTMLElement
  switch (v.view) {
    case "products":
    case "leaderboard": node = renderList(v); break
    case "product": node = renderProduct(v.product, withBack); break
    case "deals": node = renderDeals(v); break
    case "compare": node = renderCompare(v); break
    case "launch_plan": node = renderPlan(v.plan); break
    default: node = h("div", { class: "empty" }, (v as { message?: string }).message || "Something went wrong.")
  }
  if (withBack && v.view !== "product") node.prepend(h("button", { class: "link back", onclick: () => previous && render(previous) }, "← Back"))
  const consumerView = v.view !== "launch_plan" && v.view !== "error"
  root.replaceChildren(node, consumerView ? shortlistBar() : "")
}

// Drill into a product without leaving the conversation; fall back to the site.
async function showProduct(slug: string, url: string) {
  root.setAttribute("aria-busy", "true")
  try {
    const res = await app.callServerTool({ name: "get_product", arguments: { slug } })
    const sc = res.structuredContent as View | undefined
    if (sc?.view === "product") render(sc, true)
    else open(url)
  } catch {
    open(url)
  } finally {
    root.removeAttribute("aria-busy")
  }
}

// --- host wiring -----------------------------------------------------------
function applyContext(ctx: ReturnType<App["getHostContext"]>) {
  if (!ctx) return
  if (ctx.theme) applyDocumentTheme(ctx.theme)
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables)
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts)
}

app.ontoolresult = (params) => {
  const sc = params.structuredContent as View | undefined
  if (!sc) return
  previous = sc
  render(sc)
}
app.onhostcontextchanged = (ctx) => applyContext(ctx)

await app.connect()
applyContext(app.getHostContext())
