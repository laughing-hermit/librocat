# @librocat/server

The MCP tool table and the librocat version (internal workspace package,
never published). The web app serves both at `/mcp`, for librocat Cloud and a
self-hosted librocat.

- `src/tools.ts`: the tool table, defined once; the `/mcp` route imports it as
  `@librocat/server/tools`.
- `src/version.ts`: the one version literal, the `serverInfo.version` agents
  see. The plugin's manifests carry none.

```bash
pnpm test          # unit tests
```
