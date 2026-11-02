import { capture, trackSessionStart } from "./analytics.js"
import { OPENAI_APPS_CHALLENGE } from "./config.js"
import { getProduct } from "./api.js"
import { isDead, loadHealth } from "./health.js"
import { productPath, rawSiteUrl, readImageToken, readToken, withMicrolaunchRef, type Token } from "./links.js"
import { briefPage, homePage, privacyPage, supportPage } from "./pages.js"
import { ADMIN_TOKEN } from "./config.js"
import { runLinks, runReport, runSnapshotAndLinks } from "./jobs.js"
import { buildReport, renderReport } from "./report.js"
import { snapshot } from "./snapshot.js"
import { upstreamStats } from "./upstream.js"
import { timingSafeEqual } from "node:crypto"
import { inBackground } from "./runtime.js"
import { detectHost, handler } from "./server.js"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, mcp-session-id, mcp-protocol-version, last-event-id, authorization",
  "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version",
}

const html = (body: string) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" } })
// Link fetchers (incl. the assistants' own browsing agents) are redirected but
// not counted as clicks.
const BOTS = /bot|crawl|spider|preview|slurp|facebookexternalhit|embedly|unfurl|headless|chatgpt-user|oai-searchbot|gptbot|claude-user|claudebot|anthropic|perplexity/i

// "product" tokens carry only the slug; the product's own website is looked
// up at click time (cached), falling back to its Microlaunch page.
async function destination(t: Token): Promise<{ url: string; resolved: "website" | "microlaunch" | "fallback" }> {
  const fallback = () => ({ url: rawSiteUrl(t.slug ? productPath(t.slug) : "/", t.host, t.tool), resolved: "fallback" as const })
  if (t.kind === "microlaunch") return { url: t.u!, resolved: "microlaunch" }
  // Links handed out before a site died (e.g. old chats) are re-checked at click time.
  if (t.kind === "website") return isDead(await loadHealth(), t.u) ? fallback() : { url: t.u!, resolved: "website" }
  const product = await getProduct(t.slug!).catch(() => null)
  const site = withMicrolaunchRef(product?.website, t.host, t.tool)
  return site ? { url: site, resolved: "website" } : { url: rawSiteUrl(productPath(t.slug!), t.host, t.tool), resolved: "microlaunch" }
}

// Single router shared by the Worker entry and the local Node dev server.
export async function route(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/$/, "") || "/"

  if (path === "/mcp") {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })
    if (request.method === "POST") {
      const host = detectHost(request)
      inBackground(request.clone().json().then((b) => trackSessionStart(host, b), () => {}))
    }
    const res = await handler.fetch(request)
    const headers = new Headers(res.headers)
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v)
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  }

  if (path.startsWith("/go/")) {
    const token = readToken(path.slice(4))
    if (!token) return new Response("Invalid link", { status: 404 })
    const dest = await destination(token)
    if (!BOTS.test(request.headers.get("user-agent") || "")) {
      capture("mcp_link_click", token.host, { tool: token.tool, kind: token.kind, resolved: dest.resolved, slug: token.slug, dest_host: new URL(dest.url).hostname })
    }
    return new Response(null, { status: 302, headers: { location: dest.url, "cache-control": "no-store", "referrer-policy": "no-referrer-when-downgrade" } })
  }

  if (path.startsWith("/img/")) {
    const src = readImageToken(path.slice(5))
    if (!src) return new Response("Not found", { status: 404 })
    try {
      const upstream = await fetch(src, { signal: AbortSignal.timeout(8_000), cf: { cacheTtl: 86_400, cacheEverything: true } } as RequestInit)
      const type = upstream.headers.get("content-type") || ""
      const size = Number(upstream.headers.get("content-length") || 0)
      if (!upstream.ok || !type.startsWith("image/") || size > 2_000_000) return new Response("Not found", { status: 404 })
      return new Response(upstream.body, {
        headers: {
          "content-type": type,
          "cache-control": "public, max-age=86400, immutable",
          "cross-origin-resource-policy": "cross-origin",
          "access-control-allow-origin": "*",
          "x-content-type-options": "nosniff",
          // SVGs opened directly must not run script on this origin.
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        },
      })
    } catch {
      return new Response("Not found", { status: 404 })
    }
  }

  if (path.startsWith("/admin/")) return admin(request, url, path)

  if (path === "/.well-known/openai-apps-challenge") {
    return OPENAI_APPS_CHALLENGE
      ? new Response(OPENAI_APPS_CHALLENGE, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } })
      : new Response("Not configured", { status: 404 })
  }
  if (path === BRIEF_PATH) {
    const r = await buildReport().catch(() => null)
    const page = briefPage({
      products: r?.snapshot.counts.products ?? 0,
      deals: r?.snapshot.counts.deals ?? 0,
      links: r?.links.tracked ?? 0,
      dead: r?.links.dead ?? 0,
      apiPerDay: Math.max(...(r?.api ?? []).map((d) => d.upstream_calls), 0),
      catalogAt: r?.snapshot.catalog_at.slice(0, 16).replace("T", " ") ?? "—",
    })
    return new Response(page, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } })
  }
  if (path === "/privacy") return html(privacyPage())
  if (path === "/support") return html(supportPage())
  if (path === "/") return html(homePage())
  return new Response("Not found", { status: 404 })
}

// Unlisted project brief (share the link, don't publish it).
const BRIEF_PATH = "/brief/86632db1cfb8c2eb"

export { detectHost }

// --- Admin (token: ADMIN_TOKEN secret, via "Authorization: Bearer" or ?token=) --
//   GET  /admin/status            snapshot freshness, link coverage, API calls
//   GET  /admin/report            the daily report as a web page
//   POST /admin/run?task=snapshot|catalog|links|recheck|report   run a job now
//        (recheck = re-check withheld links only, e.g. after a rule change)
async function admin(request: Request, url: URL, path: string): Promise<Response> {
  const given = Buffer.from((request.headers.get("authorization") || "").replace(/^Bearer /, "") || url.searchParams.get("token") || "")
  const expected = Buffer.from(ADMIN_TOKEN)
  if (!ADMIN_TOKEN || given.length !== expected.length || !timingSafeEqual(given, expected)) return new Response("Not found", { status: 404 })
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } })
  try {
    if (path === "/admin/status") {
      const snap = await snapshot()
      const report = snap ? await buildReport() : null
      return json({ snapshot: snap?.meta ?? null, links: report?.links ?? null, api_calls_by_day: report?.api ?? [], this_isolate_upstream: upstreamStats })
    }
    if (path === "/admin/report") {
      return new Response(renderReport(await buildReport()), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } })
    }
    if (path === "/admin/run" && request.method === "POST") {
      const task = url.searchParams.get("task")
      const budget = Number(url.searchParams.get("budget") || "") || undefined
      if (task === "snapshot" || task === "catalog") return json(await runSnapshotAndLinks({ catalog: task === "catalog", budget: budget ?? 0 }))
      if (task === "links") return json(await runLinks(budget))
      if (task === "recheck") return json(await runLinks(budget, true))
      if (task === "report") return json(await runReport())
    }
    return json({ error: "unknown admin route" }, 404)
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500)
  }
}
