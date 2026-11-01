import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { LINK_PROXY, LINK_SECRET, PUBLIC_URL, SITE_URL, type Host } from "./config.js"

// Every outbound link is attributed so plugin traffic shows up per host and
// per tool in analytics. With LINK_PROXY on, links go through /go/<token> on
// this server, which records the click (aggregate, no personal data) and
// redirects.
//
// Tokens are AES-256-GCM encrypted, not just signed: models can decode base64,
// and given a readable destination they rewrite links to skip the proxy.
// Encryption also authenticates, so /go cannot be used as an open redirect.

// "product": resolved at click time to the product's own website (falls back
// to its Microlaunch page). "microlaunch" / "website": fixed destination `u`.
export type LinkKind = "product" | "microlaunch" | "website"
export type LinkMeta = { host: Host; tool: string; kind: LinkKind; slug?: string }
export type Token = LinkMeta & { u?: string }

const proxyOn = () => LINK_PROXY && Boolean(LINK_SECRET) && Boolean(PUBLIC_URL)
const sign = (payload: string) => createHmac("sha256", LINK_SECRET).update(payload).digest("base64url").slice(0, 22)
const goKey = () => createHash("sha256").update(`${LINK_SECRET}:go:v2`).digest()

function seal(t: Token) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", goKey(), iv)
  // Compact positional payload keeps URLs short.
  const body = Buffer.concat([cipher.update(JSON.stringify([t.host, t.tool, t.kind, t.slug ?? "", t.u ?? ""]), "utf8"), cipher.final()])
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url")
}

function open(token: string): Token | null {
  try {
    const raw = Buffer.from(token, "base64url")
    if (raw.length < 29) return null
    const decipher = createDecipheriv("aes-256-gcm", goKey(), raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(raw.length - 16))
    const json = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8")
    const [host, tool, kind, slug, u] = JSON.parse(json) as [Host, string, LinkKind, string, string]
    return { host, tool, kind, ...(slug ? { slug } : {}), ...(u ? { u } : {}) }
  } catch {
    return null
  }
}

function outLink(meta: LinkMeta, target: string) {
  if (!proxyOn()) return target
  return `${PUBLIC_URL}/go/${seal({ ...meta, u: meta.kind === "product" ? undefined : target })}`
}

export function readToken(token: string): Token | null {
  if (!LINK_SECRET) return null
  // Legacy v1 tokens (signed base64 JSON, "<payload>.<sig>") from early chats.
  const dot = token.lastIndexOf(".")
  if (dot > 0) {
    const payload = token.slice(0, dot)
    const given = Buffer.from(token.slice(dot + 1))
    const expected = Buffer.from(sign(payload))
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
    try {
      const t = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Token
      return t.u && /^https?:\/\//.test(t.u) ? t : null
    } catch {
      return null
    }
  }
  const t = open(token)
  if (!t) return null
  if (t.kind === "product") return t.slug ? t : null
  return t.u && /^https?:\/\//.test(t.u) ? t : null
}

// Logos are served through /img/<signed token> on this server: one origin to
// allow in widget CSPs, explicit cross-origin headers (host sandboxes may
// require CORP), and edge caching. Signing keeps it from being an open proxy.
const IMG_NS = "img:"
export function imageLink(src: string | null | undefined) {
  if (!src || !/^https?:\/\//.test(src)) return null
  if (!LINK_SECRET || !PUBLIC_URL) return src
  const payload = Buffer.from(src, "utf8").toString("base64url")
  return `${PUBLIC_URL}/img/${payload}.${sign(IMG_NS + payload)}`
}

export function readImageToken(token: string): string | null {
  if (!LINK_SECRET) return null
  const dot = token.lastIndexOf(".")
  if (dot < 1) return null
  const payload = token.slice(0, dot)
  const given = Buffer.from(token.slice(dot + 1))
  const expected = Buffer.from(sign(IMG_NS + payload))
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  const src = Buffer.from(payload, "base64url").toString("utf8")
  return /^https?:\/\//.test(src) ? src : null
}

export function siteLink(path: string, host: Host, campaign: string, extra: Record<string, string> = {}) {
  const url = new URL(rawSiteUrl(path, host, campaign, extra))
  const slug = /^\/p\/([^/]+)/.exec(url.pathname)?.[1]
  return outLink({ host, tool: campaign, kind: "microlaunch", ...(slug ? { slug } : {}) }, url.toString())
}

export function rawSiteUrl(path: string, host: Host, campaign: string, extra: Record<string, string> = {}) {
  const url = new URL(path, SITE_URL)
  url.searchParams.set("ref", host)
  url.searchParams.set("utm_source", host)
  url.searchParams.set("utm_medium", "mcp_app")
  url.searchParams.set("utm_campaign", campaign)
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v)
  return url.toString()
}

// Maker websites get Microlaunch attribution so makers see us in their own
// analytics (ref=microlaunch is the convention most launch directories use).
export function withMicrolaunchRef(raw: string | null | undefined, host: Host, campaign: string) {
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  url.searchParams.set("ref", "microlaunch")
  url.searchParams.set("utm_source", "microlaunch")
  url.searchParams.set("utm_medium", `${host}_app`)
  url.searchParams.set("utm_campaign", campaign)
  return url.toString()
}

export function websiteLink(raw: string | null | undefined, host: Host, campaign: string, slug: string) {
  const target = withMicrolaunchRef(raw, host, campaign)
  return target ? outLink({ host, tool: campaign, kind: "website", slug }, target) : null
}

// The main link for a product: its own website, resolved at click time by
// /go so tool calls don't need an extra lookup. Without the proxy, falls back
// to the Microlaunch page (we don't know the website without that lookup).
export function productLink(slug: string, host: Host, campaign: string) {
  if (!proxyOn()) return siteLink(productPath(slug), host, campaign)
  return outLink({ host, tool: campaign, kind: "product", slug }, "")
}

export const productPath = (slug: string) => `/p/${encodeURIComponent(slug)}`
export const categoryPath = (slug: string) => `/category/${encodeURIComponent(slug)}`
export const tagPath = (slug: string) => `/tag/${encodeURIComponent(slug)}`
export const altPath = (slug: string) => `/alt/${encodeURIComponent(slug)}`

// Base64url JSON so the draft survives login redirects as a single param.
export function encodeDraft(draft: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(draft), "utf8").toString("base64url")
}
