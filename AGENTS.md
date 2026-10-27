# Notes for AI agents

For AI coding agents working in this repository (Claude Code reads it through
CLAUDE.md). People start with README.md, CONTRIBUTING.md, and DEVELOPERS.md;
this file keeps what an agent tends to forget.

## Before you change anything

- Check a change with `pnpm run lint && pnpm run typecheck && pnpm run build
  && pnpm test` and `pnpm run plugin`. For the hosted service, also run
  `pnpm run e2e` (CONTRIBUTING.md).
- Browser tests (`apps/web/browser`, TesterArmy's e2e) run in `pnpm run e2e`.
  Write them with exact steps (locators), not `agent.*`: they call no model
  and need no token, and an agent step fails the run. The model is for a bug
  bash (`e2e explore`, browser/README.md), with a Vercel OIDC token in
  `apps/web/.env.e2e.local` (`vercel env pull .env.e2e.local`).
- UI: `pnpm run lint` also runs @shadcn/lint's design-system rules over
  `apps/web` (`apps/web/.oxlintrc.json`). Use a component's variants instead
  of restyling it; add a variant in `src/components/ui` only when the design
  calls for one.
- After `pnpm exec shadcn add`, check what it wrote. It has imported `cn`
  from the unrelated `cn` npm package, and added that package to
  package.json: import from `@/lib/utils`, and remove the package. Say no
  when it asks to overwrite a component we have (`yes n | pnpm exec shadcn
  add …`): ours carry fixes, such as button.tsx's hover.
- Requests cost: each is a Vercel function, and most are counted Convex
  calls, against the library's allowance too. Dashboard links don't
  prefetch (`prefetch={false}`), but the top bar's and a
  Library row's load on hover (`app-header.tsx`, `lazy-view.tsx`). Nothing polls but a file being read
  (`refresh-while.tsx`, backing off and stopping), the proxy matches only
  the pages it guards, and a page reads each thing once. Keep it that way.

## Running librocat Cloud

Run these from `apps/web`; `--prod` targets production.

- **The weekly funnel email** (`convex/funnel.ts`; docs/cloud.md, "The
  weekly funnel"). Every Monday at 09:00 UTC, the owner gets the week's
  sign-ups, agents connected, concepts written, searches, and paying
  libraries, with which agents they use (coding or desktop). It also shows how far the week before's sign-ups got: signed up
  → connected an agent → wrote a concept → came back. It reads only what
  librocat already records.
  - `npx convex run --prod funnel:preview`: the numbers, without sending.
  - `npx convex run --prod funnel:send`: send it now.
  - The recipient is `LIBROCAT_FUNNEL_EMAIL` on the Convex deployment
    (`npx convex env set --prod LIBROCAT_FUNNEL_EMAIL <address>`; separate
    several addresses with commas). Unset, nothing is sent.
- **Analytics:** Vercel Web Analytics on every page of Cloud, the
  dashboard's too, plus a few named events (`src/lib/analytics.ts`; the
  privacy page lists them). A page view reports its route, never what the
  page shows: no id, search, title, or token leaves the browser, and an
  event carries only kinds and ranges. Keep it that way, and add an event
  only with a line on the privacy page. Anything finer about product use is
  measured from Convex, as the funnel above does.
- **The model:** `npx convex run --prod probe:models` calls Jev once.
  `probe:judge` scores Jev on librocat's own judgments.
- **After a deploy:** the site and `/.well-known/oauth-authorization-server`
  answer 200, and `/mcp` answers 401 with its sign-in challenge.
  `npx convex run --prod fileProbe:run` says whether pictures convert to
  JPEG and office documents are read.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
