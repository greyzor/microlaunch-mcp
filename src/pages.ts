import { PUBLIC_URL, SITE_URL, toolEnabled } from "./config.js"

// Public pages the app directories require (support + privacy notice).
// Plain server-rendered HTML; no scripts, no cookies.

const layout = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Microlaunch app</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#16161c;--muted:#5d5d6b;--accent:#5b4cf0;--line:#e6e6ec}
@media (prefers-color-scheme:dark){:root{--bg:#121216;--fg:#f1f1f5;--muted:#a3a3b2;--accent:#8f84fb;--line:#2b2b35}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:680px;margin:0 auto;padding:40px 16px 64px}
h1{font-size:28px;letter-spacing:-.02em;margin:0 0 4px}h2{font-size:18px;margin:32px 0 8px}
p,li{color:var(--muted)}a{color:var(--accent)}.brand{font-weight:700;color:var(--accent);text-decoration:none}
nav{display:flex;gap:16px;margin-bottom:32px;font-size:14px}code{font-size:14px}
table{border-collapse:collapse;width:100%;font-size:14px}td,th{border-bottom:1px solid var(--line);padding:8px 6px;text-align:left;vertical-align:top}
</style></head><body><main>
<nav><a class="brand" href="${SITE_URL}">Microlaunch</a><a href="/support">Support</a><a href="/privacy">Privacy</a></nav>
${body}
</main></body></html>`

export const homePage = () => layout("Microlaunch for ChatGPT & Claude", `
<h1>Microlaunch for ChatGPT &amp; Claude</h1>
<p>Find tools and apps built by indie makers, compare them, browse the best of each category, and see maker deals — right inside your AI assistant.</p>
<h2>Connect</h2>
<p>MCP endpoint: <code>${PUBLIC_URL || ""}/mcp</code> (Streamable HTTP, no authentication).</p>
<p>Explore everything on <a href="${SITE_URL}">microlaunch.net</a>.</p>`)

export const supportPage = () => layout("Support", `
<h1>Support</h1>
<p>Questions, bugs or a product listed incorrectly? Email <a href="mailto:microlaunch@stimpack.io">microlaunch@stimpack.io</a> and we'll get back to you within two business days.</p>
<h2>Common questions</h2>
<ul>
<li><b>Which products appear?</b> Products launched or listed on Microlaunch. Results come from Microlaunch's public directory and rankings.</li>
<li><b>What does “Featured” mean?</b> The maker used a paid Microlaunch launch package. Featured products are labelled wherever they appear.</li>
<li><b>Where are deal codes?</b> On each product's Microlaunch page.</li>
<li><b>Can I remove my product?</b> Yes — email us from the address you used on Microlaunch.</li>
</ul>`)

export const privacyPage = () => layout("Privacy notice", `
<h1>Privacy notice</h1>
<p>This notice covers the Microlaunch app for ChatGPT, Claude and other AI assistants (the “App”). It supplements the <a href="${SITE_URL}/privacy">Microlaunch privacy policy</a>.</p>
<h2>What the App receives</h2>
<p>When your assistant uses the App, it sends us only the inputs of the tool it calls — for example a search phrase, a category, product names to compare, or (when you ask for launch planning) your product's URL, name and description. Your assistant may also attach technical context it shares with every app, such as your locale, approximate location or a short summary of the request; we use it only to answer that request and do not store it. We do not receive your name, email address, account details or full conversation history.</p>
<h2>What we record</h2>
<table>
<tr><th>Data</th><th>Purpose</th></tr>
<tr><td>Tool name, tool inputs (e.g. search phrase, category), number of results, response time, errors, assistant (ChatGPT / Claude / other) and the name and version of the app that connects (e.g. Cursor 1.2), approximate country</td><td>Measure which features are used and improve results</td></tr>
<tr><td>Clicks on links shown by the App: assistant, tool, product, destination type, approximate country</td><td>Count visits the App sends to Microlaunch and to makers' websites</td></tr>
</table>
<p>We do <b>not</b> store IP addresses, user agents, cookies or any identifier that links events to a person, and we do not build profiles. Links opened from the App pass through <code>${PUBLIC_URL || ""}/go/…</code>, which records the click as described above and immediately redirects you. Links to makers' websites include <code>ref=microlaunch</code> and UTM parameters so makers can see Microlaunch as the source.</p>
<h2>Who processes it</h2>
<p>Cloudflare (hosting) and PostHog (product analytics, EU region). We do not sell or share this data for advertising.</p>
<h2>Retention and your choices</h2>
<p>Analytics events are kept for up to 12 months and are never linked to an individual. You can disconnect the App at any time in your assistant's settings, and you can avoid click measurement by visiting <a href="${SITE_URL}">microlaunch.net</a> directly. For any request, contact <a href="mailto:microlaunch@stimpack.io">microlaunch@stimpack.io</a>.</p>
<p><small>Last updated: 2026-10-01</small></p>`)

// Project brief for the team: unlisted (random path in app.ts, noindex), with
// live numbers from the daily report.
type BriefStats = { products: number; deals: number; links: number; dead: number; apiPerDay: number; catalogAt: string }

export const briefPage = (s: BriefStats) => layout("Microlaunch in ChatGPT & Claude: project brief", `
<style>main{max-width:820px}.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:20px 0}
.tile{border:1px solid var(--line);border-radius:12px;padding:12px 14px}.tile b{display:block;font-size:22px;color:var(--fg)}
.tag{font-size:11px;font-weight:650;text-transform:uppercase;border:1px solid currentColor;border-radius:999px;padding:0 6px;color:var(--muted)}
.ok{color:#13804b}.todo{color:#c42b2b}.later{color:#a15c00}li{margin:4px 0}</style>
<h1>Microlaunch in ChatGPT &amp; Claude</h1>
<p>One hosted server that lets ChatGPT, Claude and any AI assistant recommend Microlaunch products, with every visit tracked back to us. Live numbers below are updated automatically (catalog as of ${s.catalogAt} UTC).</p>
<div class="tiles">
<div class="tile"><b>${s.products.toLocaleString("en")}</b>products searchable</div>
<div class="tile"><b>${s.deals}</b>maker deals</div>
<div class="tile"><b>${s.links.toLocaleString("en")}</b>links checked daily</div>
<div class="tile"><b>${s.dead.toLocaleString("en")}</b>broken links withheld</div>
<div class="tile"><b>${s.apiPerDay}</b>calls/day to our API, whatever the traffic</div>
</div>

<h2>1. The Microlaunch MCP server</h2>
<p>Runs on Cloudflare at <code>${PUBLIC_URL}/mcp</code>. Read-only: nothing can submit, vote or buy.</p>
<table>
<tr><th>Tool</th><th>What it does</th></tr>
${toolEnabled("search_products") ? `<tr><td>search_products <span class="tag">alpha</span></td><td>Find tools for a need, with pricing, platform and category filters</td></tr>` : ""}
<tr><td>browse_category</td><td>Best tools in a category</td></tr>
${toolEnabled("browse_tag") ? `<tr><td>browse_tag <span class="tag">alpha</span></td><td>Best tools with a tag (narrower than categories)</td></tr>` : ""}
<tr><td>top_launches</td><td>Today's / this week's leaderboard</td></tr>
<tr><td>get_product</td><td>One product's details, awards, reviews</td></tr>
${toolEnabled("compare_products") ? `<tr><td>compare_products <span class="tag">alpha</span></td><td>2–4 products side by side, by name</td></tr>` : ""}
<tr><td>list_deals</td><td>Maker discounts (codes stay on microlaunch.net)</td></tr>
</table>
<ul>
<li><b>Interactive widget</b> inside the chat: product lists, leaderboard, detail cards, side-by-side compare, deals, a star shortlist the assistant can see, "Ask in chat" buttons, light/dark.</li>
<li><b>Catalog snapshot</b>: tools read a copy of the catalog kept on Cloudflare (leaderboard and deals refreshed every 15 min, full catalog hourly). Our API load is fixed by that schedule, not by chat traffic; answers take 30–300 ms.</li>
<li><b>Tracked links</b>: every product link goes to the maker's own site tagged <code>ref=microlaunch</code> + UTMs, and each click is counted (no personal data). Links are encrypted so assistants can't strip the tracking.</li>
<li><b>Link health</b>: every link is re-checked daily. Broken sites are never shown (the user lands on the product's Microlaunch page instead) and dead deals are hidden. A daily report lists them for cleanup.</li>
<li><b>Directory requirements</b>: public <a href="/privacy">privacy notice</a>, <a href="/support">support page</a>, domain verification, capped results, no prices or upgrade pitches.</li>
</ul>

<h2>2. The ChatGPT app</h2>
<ul>
<li><span class="ok">Done</span>: connected in developer mode as "Microlaunch (dev)" and tested with real prompts.</li>
<li>Consumer-only to fit OpenAI's rules: launch planning is off, no plans/prices/checkout, Featured products labelled.</li>
<li>Submission package ready: listing, logo, 5 positive + 3 negative test cases, domain verified.</li>
<li>After approval OpenAI rescans the server daily: changes to existing tools ship by deploying; brand-new tools need re-approval.</li>
</ul>

<h2>3. Claude</h2>
<ul>
<li><b>claude.ai / Claude desktop</b>: same server as a custom connector, <code>${PUBLIC_URL}/mcp?host=claude</code>. Directory listing to follow.</li>
<li><b>Claude Code plugin</b>: a plugin marketplace (server + a "find tools" skill) that installs with two commands and passes the plugin directory checks.</li>
</ul>

<h2>4. How to try it</h2>
<table>
<tr><th>Where</th><th>Steps</th></tr>
<tr><td>ChatGPT (dev)</td><td>New chat → Plugins → tick Microlaunch (dev) → "Find me a free invoicing tool for freelancers", "Best AI tools on Microlaunch?", "Compare Tag Parrot and AIMD", "What launched this week?", "Any deals on marketing tools?"</td></tr>
<tr><td>claude.ai</td><td>Settings → Connectors → Add custom connector → URL above → enable it in a chat's tools menu → same prompts</td></tr>
<tr><td>Claude Code</td><td><code>/plugin marketplace add ./plugins/claude-plugin</code> then <code>/plugin install microlaunch@microlaunch</code></td></tr>
<tr><td>Any MCP client</td><td>Point it at <code>${PUBLIC_URL}/mcp</code> (Streamable HTTP, no auth)</td></tr>
</table>

<h2>5. What's missing</h2>
<ul>
<li class="todo">Daily broken-link email: needs the email API key set on the server.</li>
<li class="todo">ChatGPT submission: OpenAI org verification, a 1–2 min demo video, final review of listing and privacy notice.</li>
<li class="later">Search, compare and tags (alpha, switched off in production until they're good); "alternatives" tool switched off until it's good.</li>
<li class="later">Logos show as initials inside ChatGPT.</li>
<li class="later">Claude connector directory submission; publishing the Claude Code plugin repo; MCP registries; Chrome extension next.</li>
</ul>

<h2>6. Why it's worth sharing</h2>
<ol>
<li><b>A new source of visitors at a fixed, tiny cost.</b> People asking an assistant "what tool should I use?" get Microlaunch products; our API load stays at ~${s.apiPerDay} calls/day.</li>
<li><b>A stronger pitch to makers.</b> Visits show up in makers' own analytics as <code>ref=microlaunch</code>, and our click counts become "your launch got N visits from ChatGPT".</li>
<li><b>Paid launches discovered first, within the rules.</b> Featured products rank first among equally relevant results and are labelled. No ads inside ChatGPT; "get found in ChatGPT and Claude" becomes a reason to launch on Microlaunch.</li>
<li><b>Demand data.</b> What people search for and click feeds SEO pages, newsletters and maker outreach.</li>
<li><b>A cleaner directory.</b> The daily broken-link list is a ready-made cleanup queue for microlaunch.net.</li>
<li><b>Being early</b> in ChatGPT's app directory and Claude's connector and plugin directories.</li>
</ol>`)
