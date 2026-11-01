import { LINK_CHECK_BUDGET } from "./config.js"
import { checkLinks, linkTargets } from "./health.js"
import { recordCronRun, sendReport } from "./report.js"
import { refreshSnapshot, snapshot } from "./snapshot.js"
import { upstreamStats } from "./upstream.js"

// Scheduled work. These are the ONLY code paths that call the Microlaunch API
// in production; tool calls and clicks read the KV snapshot.

export async function runSnapshotAndLinks(opts: { catalog: boolean; budget?: number }) {
  const before = upstreamStats.calls
  const meta = await refreshSnapshot({ catalog: opts.catalog })
  await recordCronRun(upstreamStats.calls - before)
  const snap = await snapshot()
  const links = snap ? await checkLinks(linkTargets(snap.catalog, snap.live), opts.budget ?? LINK_CHECK_BUDGET) : null
  return { meta, links, api_calls: upstreamStats.calls - before }
}

export async function runLinks(budget = LINK_CHECK_BUDGET, onlyDead = false) {
  const snap = await snapshot()
  if (!snap) throw new Error("No snapshot yet")
  return checkLinks(linkTargets(snap.catalog, snap.live), budget, 20, onlyDead)
}

export const runReport = sendReport
