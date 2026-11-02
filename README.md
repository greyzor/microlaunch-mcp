# Microlaunch MCP server

[Microlaunch](https://microlaunch.net) is a launch platform and directory of tools and apps built by indie makers and startups (about 6,000 products). This MCP server lets ChatGPT, Claude, Cursor or any MCP client browse that catalog by category, show today's top launches, look up products and find maker deals, with an interactive widget in hosts that support MCP Apps.

It is read-only and needs no API key or account.

## Tools

| Tool | What it does |
| --- | --- |
| `browse_category` | Best-ranked products in a category ("AI tools", "productivity"…). |
| `top_launches` | The leaderboard for today, the last 7 days or the last 30 days. |
| `get_product` | One product: description, votes, reviews and awards. |
| `list_deals` | Active maker deals (claim them on microlaunch.net). |

### Coming soon

- `search_products`: find tools for a need, with filters for pricing, platform and category.
- `compare_products`: 2 to 4 products side by side.
- `browse_tag`: best-ranked products with a tag ("chrome extension", "no-code"…).

## Install

Microlaunch hosts the server at **`https://mcp.microlaunch.net/mcp`** (Streamable HTTP). Nothing to install.

**Claude** (claude.ai, Claude Desktop): Settings → Connectors → Add custom connector → `https://mcp.microlaunch.net/mcp`

**Claude Code**

```bash
claude mcp add --transport http microlaunch https://mcp.microlaunch.net/mcp
```

**ChatGPT** (developer mode): chatgpt.com/plugins → Add → Create MCP App, with URL `https://mcp.microlaunch.net/mcp` and no authentication.

**Cursor** (`.cursor/mcp.json`), **VS Code** and other clients:

```json
{
  "mcpServers": {
    "microlaunch": { "url": "https://mcp.microlaunch.net/mcp" }
  }
}
```

Then ask things like "show me the best AI tools on Microlaunch" or "what launched on Microlaunch this week?".

## Development

```bash
npm install
npm run dev     # local server on http://localhost:8787/mcp
npm run smoke   # calls every tool against the local server
```

## Support

Questions or issues: [open an issue](https://github.com/greyzor/microlaunch-mcp/issues) or email microlaunch@stimpack.io.

## License

MIT
