import { POSTHOG_HOST, POSTHOG_KEY, type Host } from "./config.js"
import { inBackground, requestScope } from "./runtime.js"

// Aggregate, non-personal telemetry (disclosed at /privacy): no IPs, user
// agents or user identifiers are sent — only host, tool and coarse country.
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

export const track = (host: Host, tool: string, props: Record<string, unknown>) => capture("mcp_tool_call", host, { tool, ...props })
