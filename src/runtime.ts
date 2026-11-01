import { AsyncLocalStorage } from "node:async_hooks"

// Per-request runtime hooks. On Workers the entry runs each request inside
// `requestScope.run({ waitUntil, country }, …)`; in local Node dev there is no
// scope and background work simply floats.
export type RequestScope = { waitUntil?: (p: Promise<unknown>) => void; country?: string }
export const requestScope = new AsyncLocalStorage<RequestScope>()

export function inBackground(p: Promise<unknown>) {
  const scope = requestScope.getStore()
  if (scope?.waitUntil) scope.waitUntil(p)
}

// Cloudflare bindings are identical for every request in an isolate, so a
// module-level holder is safe. Absent in local Node dev (no KV → live API).
export type Bindings = { CATALOG?: KVNamespace }
let bindings: Bindings = {}
export const setBindings = (b: Bindings) => { bindings = b }
export const kv = () => bindings.CATALOG
