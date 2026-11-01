import { route } from "./app.js"
import { runReport, runSnapshotAndLinks } from "./jobs.js"
import { requestScope, setBindings, type Bindings } from "./runtime.js"

// Cloudflare Workers entry. Env vars/secrets reach the code through
// process.env (nodejs_compat populates it); KV bindings via setBindings().
export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    setBindings(env)
    const country = (request as Request & { cf?: { country?: string } }).cf?.country
    return requestScope.run({ waitUntil: (p) => ctx.waitUntil(p), country }, () => route(request))
  },

  // "*/15 * * * *": leaderboard + deals (+ full catalog at minute 0) and a
  // batch of link checks.  "0 7 * * *": daily broken-link report email.
  async scheduled(controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    setBindings(env)
    const job =
      controller.cron === "0 7 * * *"
        ? runReport()
        : runSnapshotAndLinks({ catalog: new Date(controller.scheduledTime).getUTCMinutes() < 15 })
    ctx.waitUntil(
      job.then((r) => console.log(`[cron ${controller.cron}]`, JSON.stringify(r))).catch((e) => {
        console.error(`[cron ${controller.cron}] failed`, e)
        throw e
      }),
    )
  },
} satisfies ExportedHandler<Bindings>
