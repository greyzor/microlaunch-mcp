import { CACHE_TTL_MS, LIMITS } from "./config.js"
import { cached } from "./cache.js"
import { imageLink } from "./links.js"

// Thin read-only client over the public Microlaunch API. Only whitelisted
// fields leave this module; maker emails, revenue figures, vote internals
// and SEO page content never do.

type RawProduct = {
  id: number
  slug: string
  codename: string
  problem_label?: string | null
  solution_label?: string | null
  description?: string | null
  logo_src?: string | null
  market?: string | null
  stage?: string | null
  product_type?: string | null
  offer_type?: string | null
  is_premium?: boolean | null
}

type RawLaunch = {
  id: number
  product_id: number
  url?: string | null
  status: string
  start_date?: string | null
  batch_num?: number | null
  is_premium?: boolean | null
  is_boosted?: boolean | null
  votes?: number | null
  votes_all_time?: number | null
  product_points?: number | null
}

export type ProductCard = {
  slug: string
  name: string
  tagline: string
  category: string | null
  logo: string | null
  stage: string | null
  pricing_model: string | null
  featured: boolean
  votes?: number
  rank?: number
  launched_on?: string | null
}

export type ProductDetail = ProductCard & {
  description: string | null
  product_type: string | null
  votes_all_time: number
  reviews: number
  awards: string[]
  website: string | null
}

export type Deal = {
  product: ProductCard
  title: string
  type: string
  value: string | null
  featured: boolean
  // Raw maker deal page; tools only expose it through websiteLink().
  deal_url: string | null
}

export type Category = { slug: string; label: string }
export type Tag = { slug: string; label: string; count: number }

import { NotFound, RateLimited, getJson } from "./upstream.js"
import { snapshot, toTags, type SnapProduct } from "./snapshot.js"
import { isDead, loadHealth } from "./health.js"

// Every function below reads the KV snapshot first (src/snapshot.ts). The live
// API branch only runs when no snapshot exists (local dev, or before the first
// scheduled run).

function fromSnap(p: SnapProduct, withLaunch = false): ProductCard {
  return {
    slug: p.slug,
    name: p.name,
    tagline: p.tagline,
    category: p.category,
    logo: imageLink(p.logo),
    stage: p.stage,
    pricing_model: p.pricing,
    featured: p.featured,
    ...(withLaunch ? { votes: p.votes, launched_on: p.launched_on } : {}),
  }
}

const STOP = new Set(["a", "an", "and", "the", "for", "of", "to", "in", "on", "with", "my", "me", "i", "best", "good", "tool", "tools", "app", "apps", "software", "platform", "find", "some", "any"])
// Crude stemming so "invoicing" matches "invoice", "freelancers" matches "freelance".
const stem = (w: string) => (w.length > 5 ? w.replace(/(ings?|ers?|es|s)$/, "") : w)
const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

function searchSnapshot(products: SnapProduct[], q: string, f: SearchFilters) {
  const terms = q.toLowerCase().split(/[^a-z0-9+#.-]+/).filter((t) => t.length > 1 && !STOP.has(t)).map((t) => new RegExp(`\\b${esc(stem(t))}`))
  if (!terms.length) return []
  const need = Math.max(1, Math.ceil(terms.length / 2))
  const out: Array<{ p: SnapProduct; matched: number; score: number }> = []
  for (const p of products) {
    if (f.pricing && !PRICING_MATCH[f.pricing].test(p.pricing || "")) continue
    if (f.platform && !PLATFORM_MATCH[f.platform].test(p.type || "")) continue
    if (f.category && p.category !== f.category) continue
    const name = p.name.toLowerCase()
    const fields: Array<[string, number]> = [[name, 5], [p.tagline.toLowerCase(), 3], [(p.category || "").replace(/-/g, " "), 3], [p.kws, 2], [p.desc.toLowerCase(), 1]]
    let matched = 0
    let score = 0
    for (const t of terms) {
      let best = 0
      for (const [text, w] of fields) if (w > best && t.test(text)) best = w
      if (best) matched++
      score += best
    }
    if (matched >= need) out.push({ p, matched, score })
  }
  // Relevance first; within equal relevance, Featured (paid) then popularity.
  out.sort((a, b) => b.matched - a.matched || b.score - a.score || Number(b.p.featured) - Number(a.p.featured) || b.p.votes_all_time - a.p.votes_all_time)
  return out.map((x) => x.p)
}

const clip = (s: string | null | undefined, n: number) => {
  const t = (s || "").replace(/\s+/g, " ").trim()
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t
}

function toCard(p: RawProduct, launch?: RawLaunch): ProductCard {
  return {
    slug: p.slug,
    name: p.codename,
    tagline: clip(p.problem_label, 140),
    category: p.market && p.market !== "-" ? p.market : null,
    logo: imageLink(p.logo_src),
    stage: p.stage || null,
    pricing_model: p.offer_type || null,
    featured: Boolean(p.is_premium || launch?.is_premium),
    ...(launch ? { votes: launch.votes ?? 0, launched_on: launch.start_date ?? null } : {}),
  }
}

// --- Leaderboard -----------------------------------------------------------

export type Scope = "today" | "this_week" | "this_month"
const SCOPE_DAYS: Record<Scope, number> = { today: 1, this_week: 7, this_month: 30 }

async function loadBoard(): Promise<ProductCard[]> {
  // The default payload is the live leaderboard (~400 launches, 1MB+), hence
  // the long cache. Sorted by Microlaunch's own ranking (product_points).
  const data = await getJson<{ launches: RawLaunch[]; products: RawProduct[] }>("/api/launches", 30_000)
  const byId = new Map(data.products.map((p) => [p.id, p]))
  return data.launches
    .filter((l) => l.status === "live" && byId.has(l.product_id))
    .sort((a, b) => (b.product_points ?? 0) - (a.product_points ?? 0))
    .map((l) => toCard(byId.get(l.product_id)!, l))
}

function inWindow(cards: ProductCard[], scope: Scope) {
  const since = new Date(Date.now() - (SCOPE_DAYS[scope] - 1) * 86_400_000).toISOString().slice(0, 10)
  return cards.filter((c) => (c.launched_on || "") >= since)
}

async function boardCards(): Promise<ProductCard[]> {
  const snap = await snapshot()
  if (snap) return snap.live.board.map((p) => fromSnap(p, true))
  return cached("board", CACHE_TTL_MS.launches, loadBoard)
}

export async function getLeaderboard(opts: { scope: Scope; category?: string }) {
  const board = await boardCards()
  const pool = opts.category ? board.filter((c) => c.category === opts.category) : board
  // Widen the window rather than return a near-empty list (e.g. early morning).
  const order: Scope[] = ["today", "this_week", "this_month"]
  let scope = opts.scope
  let items = inWindow(pool, scope)
  while (items.length < 3 && order.indexOf(scope) < order.length - 1) {
    scope = order[order.indexOf(scope) + 1]
    items = inWindow(pool, scope)
  }
  return {
    scope,
    widened: scope !== opts.scope,
    total_in_scope: items.length,
    items: items.slice(0, LIMITS.leaderboard).map((c, i) => ({ ...c, rank: i + 1 })),
  }
}

// Competitive snapshot for a category over the last 30 days, used by plan_launch.
export async function getCategoryPressure(category: string | undefined) {
  const pool = inWindow(await boardCards(), "this_month")
  const inCat = category ? pool.filter((c) => c.category === category) : []
  return {
    live_last_30_days: pool.length,
    live_in_category: inCat.length,
    category_leaders: inCat.slice(0, 3).map((c) => c.name),
  }
}

// --- Search ----------------------------------------------------------------

export const PRICING = ["free", "subscription", "one_time", "lifetime_deal"] as const
export const PLATFORMS = ["web", "mobile", "browser_extension", "desktop", "ai_assistant", "self_hosted"] as const
export type SearchFilters = { pricing?: (typeof PRICING)[number]; platform?: (typeof PLATFORMS)[number]; category?: string }

const PRICING_MATCH: Record<(typeof PRICING)[number], RegExp> = {
  free: /free/i,
  subscription: /subscription|saas|monthly/i,
  one_time: /one-?time/i,
  lifetime_deal: /lifetime/i,
}
const PLATFORM_MATCH: Record<(typeof PLATFORMS)[number], RegExp> = {
  web: /web|saas/i,
  mobile: /mobile/i,
  browser_extension: /extension/i,
  desktop: /desktop/i,
  ai_assistant: /assistant/i,
  self_hosted: /self-hosted/i,
}

type RawSearchProduct = RawProduct & { product_type?: string | null }

function matches(p: RawSearchProduct, f: SearchFilters) {
  if (f.pricing && !PRICING_MATCH[f.pricing].test(p.offer_type || "")) return false
  if (f.platform && !PLATFORM_MATCH[f.platform].test(p.product_type || "")) return false
  if (f.category && p.market !== f.category) return false
  return true
}

export async function searchProducts(query: string, limit: number, filters: SearchFilters = {}) {
  const q = query.trim().slice(0, 80)
  const n = Math.min(limit, LIMITS.search)
  const filtered = Boolean(filters.pricing || filters.platform || filters.category)
  // Over-fetch when filtering so caps still apply to what we return.
  const fetchN = filtered ? 40 : n
  const snap = await snapshot()
  if (snap) {
    const hits = searchSnapshot(snap.catalog.products, q, filters)
    return { total: hits.length, items: hits.slice(0, n).map((p) => fromSnap(p)), degraded: false }
  }
  const key = `search:${q.toLowerCase()}:${n}:${filters.pricing ?? ""}:${filters.platform ?? ""}:${filters.category ?? ""}`
  return cached(key, CACHE_TTL_MS.search, async () => {
    try {
      const data = await getJson<{ products: RawSearchProduct[]; total: number }>(`/api/search?q=${encodeURIComponent(q)}&limit=${fetchN}`)
      const hits = data.products.filter((p) => matches(p, filters))
      // The API already ranks featured (premium) products first.
      return { total: filtered ? hits.length : data.total, items: hits.slice(0, n).map((p) => toCard(p)), degraded: false }
    } catch (e) {
      if (!(e instanceof RateLimited)) throw e
      return { ...(await localSearch(q, n, filters)), degraded: true }
    }
  })
}

// Fallback when the backend's per-IP limiter rejects us (shared egress IPs):
// keyword match over the leaderboard we already cache.
async function localSearch(q: string, n: number, filters: SearchFilters) {
  const board = await boardCards()
  // Word-prefix match so "voice" doesn't hit "invoice".
  const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 1).map((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))
  const scored = board
    .filter((c) => (!filters.category || c.category === filters.category) && (!filters.pricing || PRICING_MATCH[filters.pricing].test(c.pricing_model || "")))
    .map((c) => {
      const hay = `${c.name} ${c.tagline} ${c.category ?? ""}`.toLowerCase()
      return { c, score: terms.reduce((acc, t) => acc + (t.test(hay) ? 1 : 0), 0) }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  return { total: scored.length, items: scored.slice(0, n).map((x) => x.c) }
}

// --- Categories: best of -------------------------------------------------------

export async function getCategoryBest(category: string) {
  const snap = await snapshot()
  if (snap) {
    const inCat = snap.catalog.products.filter((p) => p.category === category).sort((a, b) => b.points - a.points || b.votes_all_time - a.votes_all_time)
    return { total: inCat.length, items: inCat.slice(0, LIMITS.leaderboard).map((p, i) => ({ ...fromSnap(p), rank: i + 1 })) }
  }
  const all = await cached(`cat:${category}`, 30 * 60_000, async () => {
    const data = await getJson<{ launches: RawLaunch[]; products: RawProduct[] }>(`/api/launches?cat=${encodeURIComponent(category)}`, 20_000)
    const byId = new Map(data.products.map((p) => [p.id, p]))
    const seen = new Set<number>()
    return data.launches
      .filter((l) => byId.has(l.product_id) && !seen.has(l.product_id) && seen.add(l.product_id))
      .sort((a, b) => (b.product_points ?? 0) - (a.product_points ?? 0))
      .map((l) => toCard(byId.get(l.product_id)!, l))
  })
  return { total: all.length, items: all.slice(0, LIMITS.leaderboard).map((c, i) => ({ ...c, rank: i + 1 })) }
}

// Accepts a slug, a label or a loose phrase ("AI tools", "seo") and returns a
// category slug, or null with suggestions.
export async function resolveCategory(input: string | undefined) {
  if (!input) return { slug: undefined, suggestions: [] as Category[] }
  const cats = await getCategories()
  const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").replace(/\b(tools?|apps?|software|products?)\b/g, "").trim()
  const q = norm(input)
  const exact = cats.find((c) => c.slug === input.toLowerCase() || norm(c.slug) === q || norm(c.label) === q)
  if (exact) return { slug: exact.slug, suggestions: [] }
  const partial = cats.filter((c) => q && (norm(c.label).includes(q) || q.includes(norm(c.slug))))
  if (partial.length === 1) return { slug: partial[0].slug, suggestions: [] }
  return { slug: undefined, suggestions: (partial.length ? partial : cats).slice(0, 12) }
}

export async function findAlternatives(name: string) {
  const q = name.trim().slice(0, 80)
  return cached(`alts:${q.toLowerCase()}`, CACHE_TTL_MS.search, async () => {
    let data: { products: Array<RawProduct & { source?: string }> }
    try {
      data = await getJson(`/api/search?q=${encodeURIComponent(q)}&action=alternatives&limit=${LIMITS.alternatives}`)
    } catch (e) {
      if (!(e instanceof RateLimited)) throw e
      return { reference: null, items: (await localSearch(q, LIMITS.alternatives, {})).items }
    }
    // "Reference" rows are the incumbent itself, not a Microlaunch product.
    const reference = data.products.find((p) => p.source === "Reference") || null
    const items = data.products.filter((p) => p.source !== "Reference").slice(0, LIMITS.alternatives).map((p) => toCard(p))
    return { reference: reference ? { slug: reference.slug, name: reference.codename } : null, items }
  })
}

// --- Product ---------------------------------------------------------------

export async function getProduct(slug: string): Promise<ProductDetail | null> {
  const s = slug.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "").slice(0, 100)
  if (!s) return null
  const snap = await snapshot()
  const hit = snap?.catalog.bySlug.get(s)
  if (hit) {
    return {
      ...fromSnap(hit, true),
      description: hit.desc || null,
      product_type: hit.type,
      votes_all_time: hit.votes_all_time,
      reviews: hit.reviews,
      awards: hit.awards,
      // Dead websites are withheld, so every caller falls back to the Microlaunch page.
      website: isDead(await loadHealth(), hit.website) ? null : hit.website,
    }
  }
  // With a snapshot, unknown slugs are simply not found: no API call, so random
  // slugs can't be used to load the API. (A product added since the last hourly
  // catalog refresh appears at the next refresh.)
  if (snap) return null
  return cached(`product:${s}`, CACHE_TTL_MS.product, async () => {
    let data: {
      launches: RawLaunch[]
      products: (RawProduct & { url?: string | null })[]
      product_review_stats?: Array<{ product_id: string; reviews_cnt: number }>
      rewards?: Array<{ label?: string; batch_num?: string; rank?: number }>
    }
    try {
      data = await getJson(`/api/launches?slug=${encodeURIComponent(s)}&all=1`)
    } catch (e) {
      if (e instanceof NotFound) return null
      throw e
    }
    const p = data.products?.[0]
    if (!p) return null
    const launches = (data.launches || []).filter((l) => l.product_id === p.id && ["live", "finished", "archived"].includes(l.status))
    const latest = launches.sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)))[0]
    const card = toCard(p, latest)
    return {
      ...card,
      description: clip(p.description || p.solution_label, LIMITS.descriptionChars) || null,
      product_type: p.product_type || null,
      votes_all_time: launches.reduce((max, l) => Math.max(max, l.votes_all_time ?? 0), 0),
      reviews: data.product_review_stats?.find((r) => String(r.product_id) === String(p.id))?.reviews_cnt ?? 0,
      awards: (data.rewards || []).map((r) => [r.label, r.rank ? `#${r.rank}` : "", r.batch_num ? `(${r.batch_num.slice(0, 4)}-${r.batch_num.slice(4)})` : ""].filter(Boolean).join(" ")).slice(0, 5),
      // Raw URL; tools only ever expose it through websiteLink()/productLink().
      // Any launch's URL is the product's website, even if that launch isn't live.
      website: latest?.url || (data.launches || []).find((l) => l.product_id === p.id && l.url)?.url || p.url || null,
    }
  })
}

// --- Deals -----------------------------------------------------------------

export async function getDeals(category?: string) {
  const snap = await snapshot()
  if (snap) {
    const health = await loadHealth()
    const now = Date.now()
    const bySlug = new Map([...snap.catalog.bySlug, ...snap.live.board.map((p) => [p.slug, p] as const)])
    const all = snap.live.deals
      .filter((d) => bySlug.has(d.slug) && (!d.expires_at || Date.parse(d.expires_at) > now))
      // A deal whose page is dead is never shown.
      .filter((d) => !isDead(health, d.deal_url))
      .sort((a, b) => Number(b.featured) - Number(a.featured) || b.priority - a.priority)
      .map<Deal>((d) => ({ product: fromSnap(bySlug.get(d.slug)!), title: d.title, type: d.type, value: d.value, featured: d.featured, deal_url: d.deal_url }))
    const pool = category ? all.filter((d) => d.product.category === category) : all
    return { total: pool.length, items: pool.slice(0, LIMITS.deals) }
  }
  const all = await cached("deals", CACHE_TTL_MS.deals, async () => {
    const data = await getJson<{
      product_deals: Array<{ product_id: string | number; status: string; title: string; deal_type: string; value?: string | null; deal_url?: string | null; is_premium?: boolean; priority?: number; expires_at?: string | null }>
      products: RawProduct[]
    }>("/api/launch-deals")
    const byId = new Map(data.products.map((p) => [String(p.id), p]))
    const now = Date.now()
    return data.product_deals
      .filter((d) => d.status === "active" && byId.has(String(d.product_id)) && (!d.expires_at || Date.parse(d.expires_at) > now))
      .sort((a, b) => Number(Boolean(b.is_premium)) - Number(Boolean(a.is_premium)) || (b.priority ?? 0) - (a.priority ?? 0))
      .map<Deal>((d) => ({
        product: toCard(byId.get(String(d.product_id))!),
        title: clip(d.title, 90),
        type: d.deal_type === "ltd" ? "lifetime deal" : d.deal_type,
        value: d.value ? clip(d.value, 40) : null,
        featured: Boolean(d.is_premium),
        deal_url: d.deal_url || null,
      }))
  })
  const pool = category ? all.filter((d) => d.product.category === category) : all
  return { total: pool.length, items: pool.slice(0, LIMITS.deals) }
}

// --- Categories ------------------------------------------------------------

export async function getCategories(): Promise<Category[]> {
  const snap = await snapshot()
  if (snap) return snap.catalog.categories
  return cached("categories", 60 * 60_000, async () => {
    const data = await getJson<{ categories: Array<{ slug: string; label?: string }> }>("/api/launch-categories")
    return data.categories.filter((c) => c.slug && c.slug !== "-").map((c) => ({ slug: c.slug, label: c.label || c.slug }))
  })
}

// --- Tags ------------------------------------------------------------------
// Tags are the finer-grained labels makers pick (e.g. "chrome extension",
// "lead generation"), served at /tag/<slug>. ~1000 of them, vs ~40 categories.

export async function getTags(): Promise<Tag[]> {
  const snap = await snapshot()
  if (snap?.catalog.tags?.length) return snap.catalog.tags
  return cached("tags", 60 * 60_000, async () => {
    const data = await getJson<{ tags: Array<{ slug: string; label?: string; count?: number }> }>("/api/tags", 20_000, 3600)
    return toTags(data.tags)
  })
}

// Tag slugs mix styles ("email-marketing", "developer tools") and come in
// near-duplicates ("ai agent" / "ai agents"), so match on a normalized form and
// prefer the most-used tag.
export async function resolveTag(input: string) {
  const tags = await getTags()
  const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9+#]+/g, " ").trim()
  const sing = (s: string) => s.split(" ").map((w) => (w.length > 3 ? w.replace(/s$/, "") : w)).join(" ")
  const q = norm(input)
  const byCount = (a: Tag, b: Tag) => b.count - a.count
  const exact = tags.find((t) => t.slug === input.trim().toLowerCase())
  if (exact) return { tag: exact, suggestions: [] as Tag[] }
  const same = tags.filter((t) => sing(norm(t.slug)) === sing(q) || sing(norm(t.label)) === sing(q)).sort(byCount)
  if (same.length) return { tag: same[0], suggestions: [] as Tag[] }
  const partial = q.length > 1 ? tags.filter((t) => norm(t.label).includes(q) || norm(t.slug).includes(q)).sort(byCount) : []
  return { tag: null, suggestions: (partial.length ? partial : [...tags].sort(byCount)).slice(0, 12) }
}

type RawTagProduct = { slug: string; codename: string; market?: string | null; problem_label?: string | null; logo_src?: string | null; is_premium?: boolean | null; launch_start?: string | null }

export async function getTagBest(slug: string) {
  // Membership comes from the API (one call per tag per hour); ranking and
  // card fields come from the snapshot when there is one.
  const members = await cached(`tag:${slug}`, 60 * 60_000, async () => {
    const data = await getJson<{ tag: { products?: RawTagProduct[] } | null }>(`/api/tags?slug=${encodeURIComponent(slug)}`, 20_000, 3600)
    const seen = new Set<string>()
    return (data.tag?.products || [])
      .filter((p) => p.slug && p.codename && !seen.has(p.slug) && seen.add(p.slug))
      .sort((a, b) => Number(Boolean(b.is_premium)) - Number(Boolean(a.is_premium)) || String(b.launch_start ?? "").localeCompare(String(a.launch_start ?? "")))
      .map((p) => ({ slug: p.slug, card: toCard({ id: 0, ...p }) }))
  })
  const snap = await snapshot()
  if (snap) {
    const inTag = members
      .map((m) => snap.catalog.bySlug.get(m.slug))
      .filter((p): p is SnapProduct => Boolean(p))
      .sort((a, b) => b.points - a.points || b.votes_all_time - a.votes_all_time)
    return { total: inTag.length, items: inTag.slice(0, LIMITS.leaderboard).map((p, i) => ({ ...fromSnap(p), rank: i + 1 })) }
  }
  return { total: members.length, items: members.slice(0, LIMITS.leaderboard).map((m, i) => ({ ...m.card, rank: i + 1 })) }
}
