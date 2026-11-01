import { getJson } from "./upstream.js"
import { kv } from "./runtime.js"

// Catalog snapshot: everything the tools need, pulled from the Microlaunch API
// by the scheduled job (src/worker.ts → scheduled) and stored in KV. Tool
// calls and /go clicks read only from here, so API/DB load is fixed by the
// schedule, not by ChatGPT traffic.
//
//   snap:catalog  all products (~5.9k), categories, awards   refreshed hourly
//   snap:live     leaderboard + active deals                   every 15 min
//   snap:meta     { catalog_at, live_at, counts }              read every 60s per isolate

export type SnapProduct = {
  id: number
  slug: string
  name: string
  tagline: string
  desc: string
  category: string | null
  logo: string | null
  stage: string | null
  pricing: string | null
  type: string | null
  featured: boolean
  website: string | null
  launched_on: string | null
  status: string | null
  votes: number
  votes_all_time: number
  points: number
  reviews: number
  awards: string[]
  kws: string
}

export type SnapDeal = {
  slug: string
  product_name: string
  title: string
  type: string
  value: string | null
  featured: boolean
  deal_url: string | null
  priority: number
  expires_at: string | null
}

export type SnapTag = { slug: string; label: string; count: number }
// `tags` is optional: snapshots written before browse_tag existed lack it
// until the next hourly catalog refresh.
export type Catalog = { products: SnapProduct[]; categories: Array<{ slug: string; label: string }>; tags?: SnapTag[] }
export type Live = { board: SnapProduct[]; deals: SnapDeal[] }
export type Meta = { catalog_at: number; live_at: number; counts: Record<string, number> }

type RawProduct = {
  id: number
  slug: string
  codename: string
  problem_label?: string | null
  solution_label?: string | null
  logo_src?: string | null
  market?: string | null
  stage?: string | null
  product_type?: string | null
  offer_type?: string | null
  is_premium?: boolean | null
  niche_kws?: unknown
  icp_kws?: unknown
}

type RawLaunch = {
  id: number
  product_id: number
  url?: string | null
  status: string
  start_date?: string | null
  is_premium?: boolean | null
  votes?: number | null
  votes_all_time?: number | null
  product_points?: number | null
}

const clip = (s: string | null | undefined, n: number) => {
  const t = (s || "").replace(/\s+/g, " ").trim()
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t
}
const words = (v: unknown) => (Array.isArray(v) ? v.join(" ") : typeof v === "string" ? v : "").toLowerCase()

function toSnap(p: RawProduct, launches: RawLaunch[], reviews: number, awards: string[]): SnapProduct {
  const sorted = [...launches].sort((a, b) => String(b.start_date ?? "").localeCompare(String(a.start_date ?? "")) || b.id - a.id)
  const latest = sorted[0]
  return {
    id: p.id,
    slug: p.slug,
    name: p.codename,
    tagline: clip(p.problem_label, 140),
    desc: clip(p.solution_label, 480),
    category: p.market && p.market !== "-" ? p.market : null,
    logo: p.logo_src || null,
    stage: p.stage || null,
    pricing: p.offer_type || null,
    type: p.product_type || null,
    featured: Boolean(p.is_premium || latest?.is_premium),
    website: sorted.find((l) => l.url)?.url || null,
    launched_on: latest?.start_date || null,
    status: latest?.status || null,
    votes: latest?.votes ?? 0,
    votes_all_time: launches.reduce((m, l) => Math.max(m, l.votes_all_time ?? 0), 0),
    points: latest?.product_points ?? 0,
    reviews,
    awards,
    kws: clip(`${words(p.niche_kws)} ${words(p.icp_kws)}`, 200),
  }
}

function group<T extends { product_id: number }>(rows: T[]) {
  const m = new Map<number, T[]>()
  for (const r of rows) m.set(r.product_id, [...(m.get(r.product_id) || []), r])
  return m
}

export async function buildCatalog(): Promise<Catalog> {
  const [all, winners, cats, tags] = await Promise.all([
    getJson<{ launches: RawLaunch[]; products: RawProduct[]; product_review_stats?: Array<{ product_id: string; reviews_cnt: number }> }>("/api/launches?all=1", 90_000, 0),
    getJson<{ winners_history: { product_rewards: Array<{ product_id: string; label: string; rank?: number; batch_num?: string }> } }>("/api/winners-history", 20_000, 0),
    getJson<{ categories: Array<{ slug: string; label?: string }> }>("/api/launch-categories", 20_000, 0),
    getJson<{ tags: Array<{ slug: string; label?: string; count?: number }> }>("/api/tags", 20_000, 0),
  ])
  const byProduct = group(all.launches)
  const reviews = new Map((all.product_review_stats || []).map((r) => [String(r.product_id), r.reviews_cnt]))
  const awards = new Map<string, string[]>()
  for (const r of winners.winners_history.product_rewards) {
    const label = [r.label, r.rank ? `#${r.rank}` : "", r.batch_num ? `(${r.batch_num.slice(0, 4)}-${r.batch_num.slice(4)})` : ""].filter(Boolean).join(" ")
    awards.set(String(r.product_id), [...(awards.get(String(r.product_id)) || []), label].slice(0, 5))
  }
  const products = all.products
    .filter((p) => p.slug && p.codename)
    .map((p) => toSnap(p, byProduct.get(p.id) || [], reviews.get(String(p.id)) ?? 0, awards.get(String(p.id)) || []))
  const categories = cats.categories.filter((c) => c.slug && c.slug !== "-").map((c) => ({ slug: c.slug, label: c.label || c.slug }))
  return { products, categories, tags: toTags(tags.tags) }
}

export function toTags(raw: Array<{ slug: string; label?: string; count?: number }>): SnapTag[] {
  return raw.filter((t) => t.slug && (t.count ?? 0) > 0).map((t) => ({ slug: t.slug, label: t.label || t.slug, count: t.count ?? 0 }))
}

export async function buildLive(): Promise<Live> {
  const [board, deals] = await Promise.all([
    getJson<{ launches: RawLaunch[]; products: RawProduct[] }>("/api/launches", 45_000, 0),
    getJson<{
      product_deals: Array<{ product_id: string | number; status: string; title: string; deal_type: string; value?: string | null; deal_url?: string | null; is_premium?: boolean; priority?: number; expires_at?: string | null }>
      products: RawProduct[]
    }>("/api/launch-deals", 20_000, 0),
  ])
  const boardProducts = new Map(board.products.map((p) => [p.id, p]))
  const liveBoard = board.launches
    .filter((l) => l.status === "live" && boardProducts.has(l.product_id))
    .sort((a, b) => (b.product_points ?? 0) - (a.product_points ?? 0))
    .map((l) => toSnap(boardProducts.get(l.product_id)!, [l], 0, []))
  const dealProducts = new Map(deals.products.map((p) => [String(p.id), p]))
  const liveDeals = deals.product_deals
    .filter((d) => d.status === "active" && dealProducts.has(String(d.product_id)))
    .map<SnapDeal>((d) => ({
      slug: dealProducts.get(String(d.product_id))!.slug,
      product_name: dealProducts.get(String(d.product_id))!.codename,
      title: clip(d.title, 90),
      type: d.deal_type === "ltd" ? "lifetime deal" : d.deal_type,
      value: d.value ? clip(d.value, 40) : null,
      featured: Boolean(d.is_premium),
      deal_url: d.deal_url || null,
      priority: d.priority ?? 0,
      expires_at: d.expires_at ?? null,
    }))
  return { board: liveBoard, deals: liveDeals }
}

// --- KV persistence -----------------------------------------------------------

const KEYS = { catalog: "snap:catalog", live: "snap:live", meta: "snap:meta" }

async function readMeta(): Promise<Meta> {
  return ((await kv()?.get(KEYS.meta, "json")) as Meta | null) ?? { catalog_at: 0, live_at: 0, counts: {} }
}

export async function refreshSnapshot(opts: { catalog: boolean }) {
  const store = kv()
  if (!store) throw new Error("CATALOG KV binding missing")
  const meta = await readMeta()
  const live = await buildLive()
  await store.put(KEYS.live, JSON.stringify(live))
  meta.live_at = Date.now()
  meta.counts.board = live.board.length
  meta.counts.deals = live.deals.length
  if (opts.catalog || !meta.catalog_at) {
    const catalog = await buildCatalog()
    const body = JSON.stringify(catalog)
    await store.put(KEYS.catalog, body)
    meta.catalog_at = Date.now()
    meta.counts.products = catalog.products.length
    meta.counts.categories = catalog.categories.length
    meta.counts.tags = catalog.tags?.length ?? 0
    meta.counts.catalog_bytes = body.length
  }
  await store.put(KEYS.meta, JSON.stringify(meta))
  return meta
}

// --- Per-isolate read cache ---------------------------------------------------

type Loaded = { meta: Meta; catalog: Catalog & { bySlug: Map<string, SnapProduct> }; live: Live }
let loaded: Loaded | null = null
let checkedAt = 0
let loading: Promise<Loaded | null> | null = null

async function load(): Promise<Loaded | null> {
  const store = kv()
  if (!store) return null
  const meta = await readMeta()
  if (!meta.catalog_at || !meta.live_at) return null
  const catalog =
    loaded && loaded.meta.catalog_at === meta.catalog_at ? loaded.catalog : await store.get<Catalog>(KEYS.catalog, "json").then((c) => (c ? { ...c, bySlug: new Map(c.products.map((p) => [p.slug, p])) } : null))
  const live = loaded && loaded.meta.live_at === meta.live_at ? loaded.live : await store.get<Live>(KEYS.live, "json")
  if (!catalog || !live) return null
  return { meta, catalog, live }
}

// Returns null when no snapshot exists (local dev, or before the first cron
// run); callers then fall back to the live API.
export async function snapshot(): Promise<Loaded | null> {
  if (loaded && Date.now() - checkedAt < 60_000) return loaded
  loading ??= load()
    .then((l) => {
      if (l) loaded = l
      checkedAt = Date.now()
      return loaded
    })
    .finally(() => (loading = null))
  return loading
}
