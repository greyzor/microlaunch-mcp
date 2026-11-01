// Central knobs for what the plugin exposes. Everything that protects the
// paid offer (result caps, what is withheld, tier facts) lives here so it can
// be reviewed in one place.

export const SITE_URL = (process.env.MICROLAUNCH_SITE_URL || "https://microlaunch.net").replace(/\/$/, "")
export const API_URL = (process.env.MICROLAUNCH_API_URL || "https://nextjs-twitter-api.vercel.app").replace(/\/$/, "")

// Shared secret that lets the backend skip its per-IP limiter for this server
// (all plugin traffic leaves from a handful of egress IPs).
export const PLUGIN_KEY = process.env.MICROLAUNCH_PLUGIN_KEY || ""

// Adds ?ml_draft= to plan_launch hand-offs. Only enable once the site has
// plugins/patches/launchpad-draft-handoff.patch applied.
export const DRAFT_HANDOFF = process.env.MICROLAUNCH_DRAFT_HANDOFF === "1"

// Public origin of this server (e.g. https://mcp.microlaunch.net). Used for
// /go click-tracking links and the /privacy and /support pages.
export const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "")
// Route result links through /go/<signed token> to record clicks.
export const LINK_PROXY = process.env.LINK_PROXY === "1"
export const LINK_SECRET = process.env.LINK_SECRET || ""

// ChatGPT app guidelines forbid showing plans/prices or promoting upgrades,
// so plan_launch hides tiers unless this is explicitly enabled (e.g. for a
// host without that rule).
export const SHOW_PRICING = process.env.SHOW_PRICING === "1"

// plan_launch (maker tool) is off in the ChatGPT directory build: the app is
// consumer-only there. Kept behind a flag for other hosts / later.
export const ENABLE_PLAN_LAUNCH = process.env.ENABLE_PLAN_LAUNCH === "1"

// find_alternatives is disabled until alternatives data/search is fixed
// (weak results in ChatGPT testing, 2026-10-01). Re-enable with "1".
export const ENABLE_ALTERNATIVES = process.env.ENABLE_ALTERNATIVES === "1"
// Tools whose results aren't reliable yet: labelled "alpha" in the tool title,
// the text answer and the widget. Remove a name once its quality is there.
export const ALPHA_TOOLS = new Set(["search_products", "compare_products"])
// Alpha tools aren't registered at all unless ENABLE_ALPHA_TOOLS=1 (off in
// production since 2026-11-01: search and compare aren't good enough yet).
export const ENABLE_ALPHA_TOOLS = process.env.ENABLE_ALPHA_TOOLS === "1"
export const toolEnabled = (name: string) => ENABLE_ALPHA_TOOLS || !ALPHA_TOOLS.has(name)

// Token from the OpenAI platform dashboard, served at
// /.well-known/openai-apps-challenge for domain verification.
export const OPENAI_APPS_CHALLENGE = (process.env.OPENAI_APPS_CHALLENGE || "").trim()

// Scheduled jobs (src/worker.ts): snapshot, link checks, daily report.
export const LINK_CHECK_BUDGET = Number(process.env.LINK_CHECK_BUDGET || 150) // URLs per 15-min run
export const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ""
export const RESEND_API_KEY = process.env.RESEND_API_KEY || ""
export const REPORT_TO = process.env.REPORT_TO || ""
export const REPORT_FROM = process.env.REPORT_FROM || "Microlaunch Alerts <alerts@updates.microlaunch.net>"

export const POSTHOG_KEY = process.env.POSTHOG_KEY || ""
export const POSTHOG_HOST = process.env.POSTHOG_HOST || "https://eu.posthog.com"

export const SERVER_INFO = { name: "microlaunch", title: "Microlaunch", version: "0.1.0" }

// Hard caps: enough to answer a question well, never enough to mirror the
// catalog. No pagination on purpose.
export const LIMITS = {
  search: 8,
  leaderboard: 10,
  alternatives: 6,
  deals: 8,
  descriptionChars: 480,
}

export const CACHE_TTL_MS = {
  launches: 10 * 60_000,
  search: 5 * 60_000,
  product: 10 * 60_000,
  deals: 15 * 60_000,
}

// Mirrors app/premium/page.tsx. Keep in sync when pricing changes.
export const TIERS = [
  {
    id: "launch-pro",
    name: "Launch Pro",
    price_usd: 49,
    best_for: "Makers who want to launch on their own date with featured placement",
    includes: [
      "Skip the queue — launch on the date you pick",
      "Featured spots: 2 boosts + Product of the Day eligibility",
      "4+ SEO-optimized pages generated for the product",
      "Deals marketplace spot",
      "Verified badge & reviews",
      "DR64+ do-follow backlinks",
      "Highlighted in Microlaunch's ChatGPT & Claude apps",
    ],
  },
  {
    id: "launch-plus",
    name: "Launch Plus",
    price_usd: 99,
    best_for: "Makers who want distribution done for them beyond Microlaunch",
    includes: [
      "Everything in Launch Pro",
      "3 automated boosts during the launch window",
      "Long-form SEO pages + auto-SEO opportunities",
      "X (Twitter) mention and a Reddit launch post",
      "Premium category placement",
    ],
  },
] as const

export const FREE_LAUNCH = {
  name: "Standard (free) launch",
  price_usd: 0,
  note: "Joins the moderation queue; typical wait is 2–3+ months and there is no featured placement.",
}

export type Host = "chatgpt" | "claude" | "claude_code" | "mcp"
