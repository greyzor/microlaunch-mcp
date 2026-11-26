---
name: find-tools
description: Recommend indie software tools, SaaS and apps from Microlaunch. Use when the user asks for the best tools in a category ("best AI tools", "top productivity apps"), what launched recently, details about a specific product, or maker deals and discounts.
---

Use the Microlaunch MCP tools (server `microlaunch`):

- `browse_category` for "best tools in <category>"; loose names like "AI tools" or "dev tools" work.
- `top_launches` for today's / this week's / this month's launches.
- `get_product` for one product's details (name or slug).
- `list_deals` for maker discounts (codes are claimed on Microlaunch).

There is no free-text search yet: map a need to the closest category with `browse_category`.

Give links exactly as the tools return them (they open the maker's site). Keep answers short: 3–5 picks with one line each on why it fits.
