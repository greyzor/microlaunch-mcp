# Microlaunch plugin for Cursor

The hosted Microlaunch MCP server, plus a skill for when to use it. Nothing runs locally and there is no API key.

Microlaunch is a community-ranked directory of tools and apps from indie makers and startups. The server is public and read-only.

## Install

From the [Cursor Marketplace](https://cursor.com/marketplace), install **Microlaunch** (Customize → Plugins).

To try this folder before it is listed, copy it to a local plugin directory and reload Cursor:

```bash
mkdir -p ~/.cursor/plugins/local
cp -R cursor-plugin ~/.cursor/plugins/local/microlaunch
```

Then open Customize and confirm the `microlaunch` MCP server (4 tools) and the `find-tools` skill.

You can also connect the server without the plugin. In a project `.cursor/mcp.json` or in `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "microlaunch": {
      "url": "https://mcp.microlaunch.net/mcp?host=cursor"
    }
  }
}
```

## Configuration

Nothing to set. `mcp.json` points at a fixed URL and the manifest declares no variables, headers, or secrets.

| | |
| --- | --- |
| Endpoint | `https://mcp.microlaunch.net/mcp?host=cursor` |
| Transport | Streamable HTTP (Cursor infers this from `url`) |
| Auth | None |

`?host=cursor` matches the other connectors (`?host=chatgpt`, `?host=claude_code`) and only labels traffic. The tools are the same as `https://mcp.microlaunch.net/mcp`.

The same server is declared in `cursor-plugin/mcp.json` and referenced from `.cursor-plugin/plugin.json` as `./mcp.json`. Cursor discovers the plugin from the repo-root marketplace manifest (`.cursor-plugin/marketplace.json` → `cursor-plugin/`).

## Tools

| Tool | What it does |
| --- | --- |
| `browse_category` | Best-ranked products in a category ("AI tools", "productivity"…). |
| `top_launches` | The leaderboard for today, the last 7 days or the last 30 days. |
| `get_product` | One product: description, votes, reviews and awards. |
| `list_deals` | Active maker deals (claim them on microlaunch.net). |

Try "show me the best AI tools on Microlaunch" or "what launched on Microlaunch this week?".

Rankings come from community votes. Use the links the tools return as-is. Listings are screened for a general audience.

## Privacy and support

- Privacy: https://mcp.microlaunch.net/privacy
- Support: https://mcp.microlaunch.net/support
- Issues: https://github.com/greyzor/microlaunch-mcp/issues

## License

MIT. The repository `LICENSE` covers this plugin. The manifest sets `"license": "MIT"`.
