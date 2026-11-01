import { API_URL, PLUGIN_KEY } from "./config.js"

// The only place that talks to the Microlaunch API. Every call is counted so
// the "requests that reach your API" claim can be checked (see /admin/status).

export class NotFound extends Error {}
export class RateLimited extends Error {}

export const upstreamStats = { calls: 0, since: Date.now(), byPath: {} as Record<string, number> }

export async function getJson<T>(path: string, timeoutMs = 15_000, edgeTtl = 300): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", "x-ml-client": "mcp-plugin" }
  if (PLUGIN_KEY) headers["x-ml-plugin-key"] = PLUGIN_KEY
  const key = path.split("?")[0]
  upstreamStats.calls++
  upstreamStats.byPath[key] = (upstreamStats.byPath[key] || 0) + 1
  console.log(`[upstream] GET ${path}`)
  // On Workers, `cf.cacheTtlByStatus` also caches successful responses in the
  // Cloudflare colo. Node ignores the extra option.
  const init = { headers, signal: AbortSignal.timeout(timeoutMs), cf: { cacheTtlByStatus: { "200-299": edgeTtl, "404": 60, "429-599": 0 } } }
  const res = await fetch(`${API_URL}${path}`, init as RequestInit)
  if (res.status === 404) throw new NotFound(path)
  if (res.status === 429) throw new RateLimited(path)
  if (!res.ok) throw new Error(`Microlaunch API ${key} responded ${res.status}`)
  const json = (await res.json()) as { status?: string; data?: T }
  if (json.status !== "success" || !json.data) throw new Error(`Microlaunch API ${key}: ${json.status || "no data"}`)
  return json.data
}
