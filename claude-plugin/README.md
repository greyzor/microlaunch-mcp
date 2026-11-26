# Microlaunch plugin for Claude Code

The hosted Microlaunch MCP server (`https://mcp.microlaunch.net/mcp?host=claude_code`)
plus a skill telling Claude when to use it. Nothing runs locally.

```
/plugin marketplace add greyzor/microlaunch-mcp
/plugin install microlaunch@microlaunch
```

Then `/mcp` should list `microlaunch` (4 tools). Try "best AI tools on Microlaunch".

Bump `version` in `.claude-plugin/plugin.json` when the plugin changes. Tool
changes need no plugin release: they ship with the server.

Privacy: https://mcp.microlaunch.net/privacy · Support: https://mcp.microlaunch.net/support
