# web

The hosted librocat: the landing page, the dashboard (control plane +
read-only browsing), the remote MCP endpoint, the OAuth authorization
server, and the Convex backend.

- `src/` — Next.js App Router, shadcn/ui components (`pnpm exec shadcn add <name>`
  to add more). `src/app/mcp/route.ts` is the remote MCP
  (mcp-handler over MCP SDK v2, the tool table from `@librocat/server/tools`);
  `src/lib/mcp-backend.ts` maps it onto Convex.
- `convex/` — the backend: schema, queries/mutations, Better Auth (`auth.ts`,
  `betterAuth/`: dashboard sign-in and the OAuth 2.1 server for agents), the
  MCP functions (`mcp.ts`, authorized by the agent's access token),
  automatic cataloging with index credits (`indexation.ts`: Jev selects,
  nothing is written; `jev.ts`), Libro, the library cat (`libro.ts` +
  `crons.ts`: the weekly review shelf and Jev's screens, which the person's
  agent works through the MCP), Stripe Checkout + webhook + meter
  (`stripe.ts`), and `dev.ts` (local seed, `setPlan`, the e2e fixtures).
- `tests/` — opt-in end-to-end tests against a running local stack.

## Run

```bash
pnpm exec convex dev                           # your dev deployment of the Convex project `librocat` (see ../../docs/cloud.md)
pnpm exec convex env set SITE_URL http://localhost:3000                  # once per deployment
pnpm exec convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)" # once per deployment; never change it after
pnpm run dev                                   # http://localhost:3000
```

`CONVEX_AGENT_MODE=anonymous pnpm exec convex dev` runs a local Convex instead,
with no account. Production: the Vercel project `librocat` (root directory
`apps/web`) builds with the command in `vercel.json`; `CONVEX_DEPLOY_KEY` is
synced by the Convex marketplace resource.

Without `NEXT_PUBLIC_CONVEX_URL` set, the app still builds and renders; auth
and data show a "backend not connected" state.

## Env

- `LIBROCAT_COMING_SOON=1` (on the Vercel project until launch): the landing
  page is the whole site, `/dashboard`, `/sign-in`, and `/sign-up` redirect to
  `/`, the header and the pricing grid say "coming soon" (`src/lib/coming-soon.ts`).
- `.env.local` (written by `convex dev`): `NEXT_PUBLIC_CONVEX_URL`. Optional:
  `NEXT_PUBLIC_LIBROCAT_MCP_URL` (override the advertised MCP URL),
  `LIBROCAT_SELF_HOST=1` (self-hosting: hides Billing and plan limits).
- On the Convex deployment (`pnpm exec convex env set`): `SITE_URL`,
  `BETTER_AUTH_SECRET`, `AUTH_RESEND_KEY`, `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, the `STRIPE_PRICE_ID_*` prices
  (`STRIPE_METER_INDEXATION` if the meter is not `librocat_indexation`),
  `AI_GATEWAY_API_KEY`, optional `AI_GATEWAY_API_KEY_FREE`,
  `LIBROCAT_EVAL_MODEL` (default `typesafe-ai/jev`),
  `LIBROCAT_AI_GATEWAY_URL`, and `LIBROCAT_SELF_HOST=1` for a self-hosted
  deployment. `.env.example` at the repo root lists every variable.

See [docs/cloud.md](../../docs/cloud.md) for the full guide to the hosted library.
