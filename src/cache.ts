// Per-instance cache with in-flight dedupe and stale-while-revalidate.
// Vercel fluid compute keeps instances warm, so this absorbs most repeat
// traffic before it reaches the Microlaunch API.

type Entry<T> = { value: T; freshUntil: number; staleUntil: number }

const MAX_ENTRIES = 500
const store = new Map<string, Entry<unknown>>()
const inflight = new Map<string, Promise<unknown>>()

function refresh<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const pending = inflight.get(key) as Promise<T> | undefined
  if (pending) return pending
  const p = load()
    .then((value) => {
      if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value as string)
      const now = Date.now()
      store.set(key, { value, freshUntil: now + ttlMs, staleUntil: now + ttlMs * 6 })
      return value
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key) as Entry<T> | undefined
  const now = Date.now()
  if (hit && hit.freshUntil > now) return hit.value
  if (hit && hit.staleUntil > now) {
    refresh(key, ttlMs, load).catch(() => {})
    return hit.value
  }
  return refresh(key, ttlMs, load)
}
