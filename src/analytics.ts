import { POSTHOG_HOST, POSTHOG_KEY, type Host } from "./config.js"
import { AsyncLocalStorage } from "node:async_hooks"
import { inBackground, requestScope } from "./runtime.js"

// Set around every tool handler (see the registerAppTool wrapper in tools.ts) so events can carry
// the tool's duration without per-tool timing code.
export const toolScope = new AsyncLocalStorage<{ t0: number }>()
const elapsed = () => {
  const s = toolScope.getStore()
  return s ? Date.now() - s.t0 : undefined
}

// Aggregate, non-personal telemetry (disclosed at /privacy): no IPs, user
// agents or user identifiers are sent — only host, tool, timing, errors, the
// connecting client app (name/version) and coarse country.
export function capture(event: string, host: Host, props: Record<string, unknown>) {
  if (!POSTHOG_KEY) return
  inBackground(
    fetch(`${POSTHOG_HOST}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: POSTHOG_KEY,
        event,
        distinct_id: `mcp:${host}`,
        properties: { host, country: requestScope.getStore()?.country, $process_person_profile: false, $ip: null, ...props },
      }),
      signal: AbortSignal.timeout(3_000),
    }).catch(() => {}),
  )
}

export const track = (host: Host, tool: string, props: Record<string, unknown>) =>
  capture("mcp_tool_call", host, { tool, duration_ms: elapsed(), ...props })

// A tool that threw. The message is ours or upstream's (URLs, status codes), never user data.
export function trackError(host: Host, tool: string, err: unknown) {
  const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  capture("mcp_tool_error", host, { tool, duration_ms: elapsed(), error: error.slice(0, 300) })
}

// MCP initialize: which client app connects (Cursor, VS Code, Claude Desktop…).
// clientInfo names the software, not the person.
export function trackSessionStart(host: Host, body: unknown) {
  const msgs = Array.isArray(body) ? body : [body]
  const init = msgs.find((m) => m && typeof m === "object" && (m as { method?: unknown }).method === "initialize") as
    | { params?: { protocolVersion?: string; clientInfo?: { name?: string; version?: string } } }
    | undefined
  if (!init) return
  const info = init.params?.clientInfo
  capture("mcp_session_start", host, {
    client_name: String(info?.name ?? "unknown").slice(0, 80),
    client_version: String(info?.version ?? "").slice(0, 40),
    protocol_version: init.params?.protocolVersion,
  })
}
