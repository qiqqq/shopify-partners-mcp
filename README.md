# Private Shopify Partners MCP for Claude Desktop

A minimal, locally running, **read-only** MCP server for Shopify Partner API app relationship events.

## Requirements

- macOS with Claude Desktop
- Node.js 20+ and npm
- Shopify Partners organization ID, Partner API client token, numeric app ID(s)

## Setup

```bash
cd /path/to/shopify-partners-mcp
npm install
```

Find Claude Desktop's config using **Settings → Developer → Edit Config** (or open `~/Library/Application Support/Claude/claude_desktop_config.json`). Add the following to the existing `mcpServers` object, changing paths and values:

```json
{
  "mcpServers": {
    "shopify-partners-private": {
      "command": "/ABSOLUTE/PATH/TO/node",
      "args": ["/ABSOLUTE/PATH/TO/shopify-partners-mcp/src/index.js"],
      "env": {
        "SHOPIFY_PARTNER_ORGANIZATION_ID": "1234567",
        "SHOPIFY_PARTNER_ACCESS_TOKEN": "YOUR_PRIVATE_TOKEN",
        "SHOPIFY_ALLOWED_APP_IDS": "111111,222222"
      }
    }
  }
}
```

Find Node's absolute path with `which node`; use the *actual* extracted directory path for the JS file. `SHOPIFY_ALLOWED_APP_IDS` is a comma-separated list of **numeric Partner app IDs**, not OAuth API keys.

Restart Claude Desktop completely (Cmd+Q). Ask Claude to call `get_app_info` on one allowed app ID and then to retrieve its recent events.

## Exposed tools

- `get_app_info(app_id)`
- `get_app_events(app_id, limit?, from?, to?, types?)` — max 100 matching results; UTC offset timestamps, e.g. `2026-10-01T00:00:00Z`
- `get_installation_stats(app_id, from?, to?)` — summary based on first 100 matching events **only**. If `complete` is false, do not interpret counts as the full period total.

## Security

- Runs only as local stdio process; no listener or remote port.
- Only fixed GraphQL queries, read-only tools and allowlisted app IDs.
- Keep the config file private (`chmod 600 ~/Library/Application\\ Support/Claude/claude_desktop_config.json`), do not commit it or store API tokens in source control.
- The Partner API token belongs to the **entire Partner organization**. An app ID allowlist in this server limits what the AI can request, **not** what a stolen token could access.
- Token still needs the Partner API client's required read permissions. Grant least privilege possible, rotate token if compromised.
- Returned event data (including shop domains, cancellation text) may be sent to the AI provider as part of a tool response. Remove `shop` fields from `EVENTS` if you want only aggregate counts to reach AI.
- Calls are limited to 12 seconds each, return at most 100 events per call. For a full historical count, pagination must be implemented.

## References

- https://shopify.dev/docs/api/partner/2026-10
- https://shopify.dev/docs/api/partner/2026-10/queries/app
- https://modelcontextprotocol.io/docs/develop/build-server
