import { kv } from "./runtime.js"
import type { Catalog, Live } from "./snapshot.js"

// Link health for every URL the app can send people to (maker websites and
// deal pages). The scheduled job checks a rolling batch each run; a URL is
// "dead" after two consecutive failures and comes back on the first success.
// Tools and /go consult isDead() so a dead link is never served: products fall
// back to their Microlaunch page, dead deals are hidden.

export type LinkState = {
  ok: boolean
  code: string // HTTP status or error kind ("dns", "tls", "timeout", "network")
  fails: number // consecutive failures
  first_fail?: number // start of the current failure streak
  checked: number
  dead_since?: number
}
export type HealthMap = Record<string, LinkState>

const KEY = "health:links"
// Bot walls and rate limits mean "a server answered"; treat as alive.
const ALIVE_CODES = new Set([401, 403, 405, 406, 429, 451, 503, 999])
// Failures that are sometimes an artifact of checking from Cloudflare (slow
// origins, TLS quirks, redirect loops, firewalls answering 400/418/520).
// Re-checked 2026-10-31 from outside Cloudflare with a browser: 520 8/10,
// network 4/4, 502 2/10, timeout 3/25 still loaded; 530/404/402/500/521/523
// 0/86 did.
const SOFT_CODES = new Set(["timeout", "502", "504", "520", "522", "525"])
// Failures that persist from Cloudflare for sites that load fine for people
// (redirect loops, firewalls blocking Worker traffic). Never withheld, but
// still listed as failing in the stored state.
const UNVERIFIABLE_CODES = new Set(["network", "400", "418"])
const HARD_AFTER = 2
const SOFT_AFTER = 4
const SOFT_MIN_SPAN = 3 * 24 * 3_600_000

// Hard failures (dead DNS/530, 404/410, 500, invalid cert…): dead after 2 in
// a row. Soft failures: dead only after 4 in a row spanning ≥3 days.
// Unverifiable failures: never dead.
export function isDeadState(s: LinkState | undefined) {
  if (!s || s.ok || UNVERIFIABLE_CODES.has(s.code)) return false
  if (SOFT_CODES.has(s.code)) return s.fails >= SOFT_AFTER && Date.now() - (s.first_fail ?? Date.now()) >= SOFT_MIN_SPAN
  return s.fails >= HARD_AFTER
}

let cache: { map: HealthMap; at: number } | null = null

export async function loadHealth(fresh = false): Promise<HealthMap> {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache.map
  const map = ((await kv()?.get(KEY, "json")) as HealthMap | null) ?? {}
  cache = { map, at: Date.now() }
  return map
}

// Health is keyed by the raw URL; links we hand out carry our own attribution
// params (see withMicrolaunchRef), which are stripped before lookups.
export const normalizeUrl = (u: string) => {
  try {
    const url = new URL(u)
    url.hash = ""
    if (url.searchParams.get("utm_source") === "microlaunch") {
      for (const k of ["ref", "utm_source", "utm_medium", "utm_campaign"]) url.searchParams.delete(k)
    }
    return url.toString()
  } catch {
    return u
  }
}

export function isDead(map: HealthMap, url: string | null | undefined) {
  return url ? isDeadState(map[normalizeUrl(url)]) : false
}

function classify(err: unknown): string {
  const m = String((err as Error)?.message || err).toLowerCase()
  if (m.includes("timeout") || m.includes("abort")) return "timeout"
  if (m.includes("dns") || m.includes("resolve") || m.includes("not found")) return "dns"
  if (m.includes("tls") || m.includes("ssl") || m.includes("certificate")) return "tls"
  return "network"
}

const BOT_HEADERS = { "user-agent": "Mozilla/5.0 (compatible; MicrolaunchLinkCheck/1.0; +https://mcp.microlaunch.net/support)", accept: "text/html,*/*" }
// Some hosts reject bot user agents (520, HTTP/2 resets, 400/418) but serve
// browsers fine, so a failed check is retried once the way a browser asks.
const BROWSER_HEADERS = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
}

async function probe(url: string) {
  const first = await probeOnce(url, BOT_HEADERS, 15_000)
  return first.ok || first.code === "dns" ? first : probeOnce(url, BROWSER_HEADERS, 25_000)
}

async function probeOnce(url: string, headers: Record<string, string>, timeoutMs: number): Promise<{ ok: boolean; code: string }> {
  try {
    const res = await fetch(url, { redirect: "follow", headers, signal: AbortSignal.timeout(timeoutMs) })
    res.body?.cancel().catch(() => {})
    // Cloudflare-specific origin errors (52x/530) mean the site is down.
    return { ok: res.status < 400 || ALIVE_CODES.has(res.status), code: String(res.status) }
  } catch (e) {
    return { ok: false, code: classify(e) }
  }
}

export function linkTargets(catalog: Catalog, live: Live) {
  const deals = live.deals.map((d) => d.deal_url).filter(Boolean) as string[]
  const liveSites = live.board.map((p) => p.website).filter(Boolean) as string[]
  const sites = catalog.products.map((p) => p.website).filter(Boolean) as string[]
  // Order = priority when everything is equally stale: deals, live launches, catalog.
  return [...new Set([...deals, ...liveSites, ...sites].map(normalizeUrl))]
}

// Checks up to `budget` URLs: never-checked first, then the oldest checks.
// With onlyDead, re-checks withheld links only (after a rule change).
export async function checkLinks(targets: string[], budget: number, concurrency = 20, onlyDead = false) {
  const store = kv()
  if (!store) throw new Error("CATALOG KV binding missing")
  const map = await loadHealth(true)
  const order = new Map(targets.map((u, i) => [u, i]))
  // Priority: never checked → suspects (failed once, re-checked ≥10 min later
  // so a blip isn't marked dead) → everything else, oldest check first.
  const now = Date.now()
  const tier = (u: string) => {
    const st = map[u]
    if (!st) return 0
    if (!st.ok && !isDeadState(st)) return now - st.checked >= 10 * 60_000 ? 1 : 3
    return 2
  }
  const queue = (onlyDead ? targets.filter((u) => isDeadState(map[u])) : targets.slice())
    .sort((a, b) => tier(a) - tier(b) || (map[a]?.checked ?? -1) - (map[b]?.checked ?? -1) || order.get(a)! - order.get(b)!)
    .slice(0, budget)
  let i = 0
  const results = { checked: 0, newly_dead: 0, recovered: 0 }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (i < queue.length) {
        const url = queue[i++]
        const prev = map[url]
        const r = await probe(url)
        const fails = r.ok ? 0 : (prev?.fails ?? 0) + 1
        const wasDead = isDeadState(prev)
        const next: LinkState = { ok: r.ok, code: r.code, fails, checked: Date.now() }
        if (!r.ok) next.first_fail = prev && !prev.ok ? (prev.first_fail ?? prev.checked) : Date.now()
        const dead = isDeadState(next)
        if (dead) next.dead_since = (wasDead && prev?.dead_since) || Date.now()
        if (dead && !wasDead) results.newly_dead++
        if (r.ok && wasDead) results.recovered++
        map[url] = next
        results.checked++
      }
    }),
  )
  // Drop URLs no longer referenced by the catalog.
  const live = new Set(targets)
  for (const u of Object.keys(map)) if (!live.has(u)) delete map[u]
  await store.put(KEY, JSON.stringify(map))
  cache = { map, at: Date.now() }
  return { ...results, tracked: Object.keys(map).length, pending: targets.filter((u) => !map[u]).length }
}
