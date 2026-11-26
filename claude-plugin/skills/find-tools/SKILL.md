---
name: find-tools
description: Recommend software tools, SaaS and apps from indie makers and startups listed on Microlaunch. Use when the user asks for the best tools in a category ("best AI tools", "top productivity apps"), what launched recently, details about a specific product, or software deals, discounts and lifetime deals.
---

Use the Microlaunch MCP tools (server `microlaunch`):

- `browse_category` for "best tools in <category>"; loose names like "AI tools" or "dev tools" work.
- `top_launches` for today's, this week's or this month's launches.
- `get_product` for one product's details (name or slug).
- `list_deals` for active maker deals (coupon codes are claimed on Microlaunch).

There is no free-text search yet: map a need to the closest category with `browse_category`.

Rankings come from community votes; present results neutrally. Listings are screened for a general audience.

Give links exactly as the tools return them. Keep answers short: 3 to 5 picks with one line each on why they fit.
