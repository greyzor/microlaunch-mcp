import { AUDIENCE_SECRET } from "./config.js"
import { getJson } from "./upstream.js"

// Microlaunch decides which products are suitable for its assistant apps and
// publishes the list of hidden product slugs (its rules stay on Microlaunch's
// side). This server only applies the list, and fails closed: with no list,
// nothing is shown, and products newer than the list are hidden until the
// next refresh has reviewed them.

export type Audience = { generated_at: string; max_product_id: number; hidden: string[]; hidden_tags: string[]; tags_ok: boolean }

export async function fetchAudience(): Promise<Audience> {
  if (!AUDIENCE_SECRET) throw new Error("MICROLAUNCH_AUDIENCE_SECRET missing")
  const a = await getJson<Audience>("/api/mcp-audience", 60_000, 0, { Authorization: `Bearer ${AUDIENCE_SECRET}` })
  if (!Array.isArray(a.hidden) || typeof a.max_product_id !== "number" || a.max_product_id <= 0) throw new Error("audience list malformed")
  return a
}

export type Gate = { product: (p: { slug: string; id?: number }) => boolean; tag: (t: { slug: string }) => boolean }

export const CLOSED: Gate = { product: () => false, tag: () => false }

export function gate(a: Audience | null | undefined): Gate {
  if (!a) return CLOSED
  const hidden = new Set(a.hidden.map((s) => s.toLowerCase()))
  const hiddenTags = new Set(a.hidden_tags.map((s) => s.toLowerCase()))
  return {
    product: (p) => !hidden.has(p.slug.toLowerCase()) && (p.id == null || p.id <= a.max_product_id),
    tag: (t) => a.tags_ok && !hiddenTags.has(t.slug.toLowerCase()),
  }
}

// Live-API mode (no snapshot: local dev): the list is fetched and cached here.
let live: { at: number; gate: Gate } | null = null
export async function liveGate(): Promise<Gate> {
  if (live && Date.now() - live.at < 10 * 60_000) return live.gate
  try {
    live = { at: Date.now(), gate: gate(await fetchAudience()) }
  } catch (e) {
    console.warn(`[audience] unavailable, showing nothing: ${(e as Error).message}`)
    live = { at: Date.now() - 9 * 60_000, gate: CLOSED }
  }
  return live.gate
}
