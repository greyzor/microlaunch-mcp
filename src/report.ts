import { REPORT_FROM, REPORT_TO, RESEND_API_KEY, SITE_URL } from "./config.js"
import { isDeadState, linkTargets, loadHealth, normalizeUrl, type LinkState } from "./health.js"
import { kv } from "./runtime.js"
import { snapshot, type SnapProduct } from "./snapshot.js"

// Daily broken-link report (cron "0 7 * * *" → emailed to REPORT_TO, also
// viewable at /admin/report). Lists every link the app currently withholds so
// it can be fixed at the source (product URL / deal URL in the Microlaunch DB).

export type DailyStats = { date: string; cron_runs: number; upstream_calls: number }
const STATS_KEY = "stats:daily"

export async function recordCronRun(upstreamCalls: number) {
  const store = kv()
  if (!store) return
  const date = new Date().toISOString().slice(0, 10)
  const all = ((await store.get(STATS_KEY, "json")) as DailyStats[] | null) ?? []
  const today = all.find((d) => d.date === date) ?? { date, cron_runs: 0, upstream_calls: 0 }
  today.cron_runs++
  today.upstream_calls += upstreamCalls
  await store.put(STATS_KEY, JSON.stringify([today, ...all.filter((d) => d.date !== date)].slice(0, 14)))
}

type Row = { product: SnapProduct | null; url: string; state: LinkState; kind: "website" | "deal"; deal?: string; name?: string; slug?: string }

export async function buildReport() {
  const snap = await snapshot()
  if (!snap) throw new Error("No snapshot yet")
  const health = await loadHealth(true)
  const stats = ((await kv()?.get(STATS_KEY, "json")) as DailyStats[] | null) ?? []
  const byUrl = new Map<string, SnapProduct>()
  for (const p of [...snap.catalog.products, ...snap.live.board]) if (p.website) byUrl.set(normalizeUrl(p.website), p)
  const dealByUrl = new Map(snap.live.deals.filter((d) => d.deal_url).map((d) => [normalizeUrl(d.deal_url!), d]))
  const bySlug = snap.catalog.bySlug

  const rows: Row[] = []
  for (const [url, state] of Object.entries(health)) {
    if (!isDeadState(state)) continue
    const deal = dealByUrl.get(url)
    if (deal) rows.push({ product: bySlug.get(deal.slug) ?? null, url, state, kind: "deal", deal: deal.title, name: deal.product_name, slug: deal.slug })
    else rows.push({ product: byUrl.get(url) ?? null, url, state, kind: "website" })
  }
  const rank = (r: Row) => (r.kind === "deal" ? 0 : r.product?.status === "live" ? 1 : r.product?.featured ? 2 : 3)
  rows.sort((a, b) => rank(a) - rank(b) || (b.state.dead_since ?? 0) - (a.state.dead_since ?? 0))

  const targets = linkTargets(snap.catalog, snap.live)
  const day = 86_400_000
  const now = Date.now()
  const checked24h = Object.values(health).filter((s) => now - s.checked < day).length
  return {
    generated_at: new Date().toISOString(),
    snapshot: { catalog_at: new Date(snap.meta.catalog_at).toISOString(), live_at: new Date(snap.meta.live_at).toISOString(), counts: snap.meta.counts },
    links: {
      tracked: targets.length,
      checked_ever: targets.filter((u) => health[u]).length,
      checked_24h: checked24h,
      dead: rows.length,
      dead_websites: rows.filter((r) => r.kind === "website").length,
      dead_deals: rows.filter((r) => r.kind === "deal").length,
      new_24h: rows.filter((r) => now - (r.state.dead_since ?? 0) < day).length,
    },
    api: stats.slice(0, 7),
    rows,
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
const ago = (t?: number) => {
  if (!t) return "—"
  const h = Math.round((Date.now() - t) / 3_600_000)
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`
}

export function renderReport(r: Awaited<ReturnType<typeof buildReport>>) {
  const l = r.links
  const coverage = l.tracked ? Math.round((l.checked_ever / l.tracked) * 100) : 0
  const tr = (row: Row) => {
    const p = row.product
    const slug = p?.slug ?? row.slug
    const label = p?.name ?? row.name
    const name = slug && label ? `<a href="${SITE_URL}/p/${encodeURIComponent(slug)}">${esc(label)}</a>` : "<i>unknown product</i>"
    const tags = [row.kind === "deal" ? "deal" : "", p?.status === "live" ? "live" : "", p?.featured ? "featured" : ""].filter(Boolean).join(" · ")
    return `<tr><td>${name}<div style="color:#888;font-size:12px">${esc(tags)}${row.deal ? ` — ${esc(row.deal)}` : ""}</div></td><td style="word-break:break-all"><a href="${esc(row.url)}">${esc(row.url)}</a></td><td><b>${esc(row.state.code)}</b></td><td>${ago(row.state.dead_since)}</td></tr>`
  }
  const api = r.api.map((d) => `<tr><td>${d.date}</td><td>${d.cron_runs}</td><td>${d.upstream_calls}</td></tr>`).join("")
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Microlaunch app · broken links</title></head>
<body style="margin:0;background:#f6f6f8;font:14px/1.5 -apple-system,Segoe UI,sans-serif;color:#16161c">
<div style="max-width:760px;margin:0 auto;padding:24px 16px">
<h1 style="font-size:20px;margin:0 0 4px">Microlaunch app: daily link report</h1>
<p style="color:#666;margin:0 0 20px">${esc(r.generated_at.slice(0, 16).replace("T", " "))} UTC · links shown in ChatGPT / Claude</p>
<table style="width:100%;border-collapse:collapse;background:#fff;border-radius:10px;margin-bottom:20px"><tr>
<td style="padding:14px"><div style="font-size:22px;font-weight:700;color:${l.dead ? "#c42b2b" : "#13804b"}">${l.dead}</div>broken links withheld</td>
<td style="padding:14px"><div style="font-size:22px;font-weight:700">${l.new_24h}</div>new in 24h</td>
<td style="padding:14px"><div style="font-size:22px;font-weight:700">${l.checked_24h}</div>checked in 24h</td>
<td style="padding:14px"><div style="font-size:22px;font-weight:700">${coverage}%</div>of ${l.tracked} links checked</td></tr></table>
<p style="color:#555">Broken links are <b>never served</b>: products fall back to their Microlaunch page and dead deals are hidden. Fix the URL on Microlaunch and it is picked up automatically within a day.</p>
<h2 style="font-size:16px;margin:24px 0 8px">Broken links (${l.dead_websites} websites, ${l.dead_deals} deals)</h2>
${r.rows.length ? `<table style="width:100%;border-collapse:collapse;background:#fff;font-size:13px" cellpadding="8"><tr style="text-align:left;color:#666"><th>Product</th><th>URL</th><th>Error</th><th>Dead for</th></tr>${r.rows.slice(0, 300).map(tr).join("")}</table>${r.rows.length > 300 ? `<p>…and ${r.rows.length - 300} more (see /admin/report).</p>` : ""}` : "<p>No broken links. 🎉</p>"}
<h2 style="font-size:16px;margin:24px 0 8px">Load on the Microlaunch API</h2>
<p style="color:#555;margin:0 0 8px">Tool calls read only from the snapshot (catalog refreshed hourly, leaderboard &amp; deals every 15 min). Calls below are the whole plugin's API usage, whatever the ChatGPT traffic.</p>
<table style="background:#fff;font-size:13px" cellpadding="6"><tr style="color:#666"><th>Day (UTC)</th><th>Scheduled runs</th><th>API calls</th></tr>${api}</table>
<p style="color:#888;font-size:12px;margin-top:24px">Snapshot: ${r.snapshot.counts.products ?? "?"} products (catalog ${esc(r.snapshot.catalog_at.slice(0, 16))}), ${r.snapshot.counts.board ?? "?"} live launches, ${r.snapshot.counts.deals ?? "?"} deals (live data ${esc(r.snapshot.live_at.slice(0, 16))}).</p>
</div></body></html>`
}

export async function sendReport() {
  const report = await buildReport()
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY secret is not set")
  const l = report.links
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: REPORT_FROM,
      to: REPORT_TO.split(",").map((s) => s.trim()).filter(Boolean),
      subject: `Microlaunch app: ${l.dead} broken link${l.dead === 1 ? "" : "s"} withheld (${l.new_24h} new)`,
      html: renderReport(report),
    }),
  })
  if (!res.ok) throw new Error(`Resend responded ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return { sent_to: REPORT_TO, dead: l.dead, new_24h: l.new_24h }
}
