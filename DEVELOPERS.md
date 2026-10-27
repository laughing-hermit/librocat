# Developing librocat

Node 24, pnpm (the version in `package.json`'s `packageManager`), and no
accounts: the service runs against a local Convex backend.

```bash
pnpm install
pnpm run build && pnpm test          # everything that needs no running service
pnpm run e2e                         # the end-to-end suites, on a throwaway local stack
```

## The service (apps/web)

```bash
cd apps/web
CONVEX_AGENT_MODE=anonymous pnpm exec convex dev     # a local Convex on :3210 (keep it running)
pnpm exec convex env set SITE_URL http://localhost:3000
pnpm exec convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
pnpm exec convex env set AUTH_DEV_LOG_CODES 1        # sign-up codes go to the Convex log
pnpm exec convex env set LIBROCAT_E2E 1              # the e2e fixtures (dev only)
pnpm run dev                                         # the site, the dashboard, and /mcp on :3000
```

Then point an agent at `http://localhost:3000/mcp` (`npx add-mcp
http://localhost:3000/mcp --name librocat`): it signs in through the browser
like it would against librocat.com. Set `BETTER_AUTH_SECRET` once:
changing it orphans the signing keys (`pnpm exec convex run
dev:resetSigningKeys` clears them on a dev deployment).

For a dashboard that looks like a real team's, seed the demo library
(`convex/demo.ts`; needs `LIBROCAT_E2E=1`):

```bash
pnpm exec convex run dev:seedDemo '{"email":"you@example.com"}'
```

It builds "Acme engineering" on the Team plan: three teammates
(maya@acme.test, the owner; dev@acme.test; ops@acme.test), 25 concepts on
five shelves (`billing/`, `deploys/`, `oncall/`, `api/`, `decisions/`)
written by their agents (Claude Code, Codex, Cursor), three sources (a web
page, a PDF, a call transcript) with the concepts that cite them, and one
review-shelf proposal of each kind. `email` (optional) adds your own account
as an admin and opens the dashboard on it; or sign in as a teammate with the
code `AUTH_DEV_LOG_CODES` writes to the Convex log. Running it again replaces
the library's contents. The other `dev:` helpers (`seed`, `createBrowserUser`,
`issueTestAccessToken`, `bulkIngest`) are the e2e suites' fixtures
(`convex/dev.ts`).

The landing page's pictures of the product come from this demo
(`src/assets/landing/`). After a UI change, take them again with the app
running, signed in as the account you seeded with (an admin):

```bash
LANDING_EMAIL=you@example.com LANDING_PASSWORD=… node scripts/landing-shots.ts
```

To run it as your own service rather than a dev copy, set
`LIBROCAT_SELF_HOST=1` on the Convex deployment (no plans, no quotas) and on
the Next.js app (no Billing tab). Automatic cataloging and Libro's screens
need Jev, through an AI Gateway key (`AI_GATEWAY_API_KEY`); without one,
writes stay as the agent left them, and the weekly review shelf is the
mechanical pass alone.

The opt-in end-to-end suites and the fake AI gateway are in
[docs/cloud.md §Local development](./docs/cloud.md#local-development).
`pnpm run e2e` runs all of them in one pass on a throwaway local stack.
CI runs the same on demand: Actions, e2e, Run workflow, on any branch. It
calls no model, so it costs nothing.
`pnpm run auth:schema` (in `apps/web`) regenerates the auth tables after a
Better Auth plugin changes.

## Layout and rules

- [docs/architecture.md](./docs/architecture.md): what lives where. A new
  format or library-science rule goes in `packages/core/src/format.ts` or
  `library.ts` (pure), never in the Convex model.
- [docs/toollist.md](./docs/toollist.md): the toolchain and the standards
  librocat follows.
- Lint and format with Biome (`pnpm run lint`); CI runs lint, typecheck,
  build, test, and the plugin check on every pull request.
