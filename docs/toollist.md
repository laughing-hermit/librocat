# Tool list

The toolchain after the move from bun to pnpm on 2026-08-20. It is the shape
that Vercel's and Supabase's open-source monorepos use: Node as the only
runtime, pnpm for packages, Turborepo for tasks, one linter and formatter
(Biome, with Oxlint running only the design-system rules), one test runner,
one bundler. Versions are the ones in the lockfile, refreshed to latest stable
on 2026-09-14 and kept current by Dependabot since (checked 2026-09-28).

## Runtime and package management

| Tool | Version | Job | Where it is configured | Daily command |
| --- | --- | --- | --- | --- |
| Node.js | 24 LTS | The only runtime: scripts, tests, Next.js, Convex CLI | Node 24 in CI and on Vercel | `pnpm run plugin` (`node scripts/check-plugin.ts`) |
| pnpm | 12.15 | Install, workspaces, lockfile. Strict `node_modules`: a package imports only what it declares | `packageManager` in `package.json`, `pnpm-workspace.yaml` (workspace globs, `allowBuilds`, `minimumReleaseAgeExclude`) | `pnpm install`, `pnpm run <task>` |

## Build, test, lint

| Tool | Version | Job | Where it is configured | Daily command |
| --- | --- | --- | --- | --- |
| Turborepo | 2.11 | Runs `build`, `test`, `typecheck`, `dev` across the workspace in dependency order, with a cache | `turbo.json` | `pnpm run build`, `pnpm test` |
| TypeScript | 7.0 | Type checking only (`tsc --noEmit`). No emit: Node strips types, esbuild bundles | `tsconfig.base.json` and one `tsconfig.json` per package | `pnpm run typecheck` |
| Biome | 2.6 | Lint and format, one tool instead of eslint + prettier. Markdown is left alone (`biome.json`): Biome 2.6's Markdown formatter turns a skill's frontmatter into invalid YAML | `biome.json` | `pnpm run lint`, `pnpm run format` |
| Oxlint + [@shadcn/lint](https://github.com/shadcn-ui/lint) | 1.89 / 0.2 | Design-system rules for `apps/web`, which agents can follow: no restyling a component outside its variants (`src/components/ui` is exempt: it is the design system), theme colors only, no arbitrary values, no inline styles, no unknown classes. Each error names the variant to use instead. Containers such as `CardContent` and `TableCell` may style their contents | `apps/web/.oxlintrc.json` | `pnpm run lint` (runs it after Biome) |
| vitest | 5.0 | Tests, Jest-style `expect`, one worker per file | None. Default globs find `tests/*.test.ts` | `pnpm test` |
| [e2e](https://github.com/tester-army/e2e) (TesterArmy) + Playwright | 0.21 / 1.64 | Browser tests with exact steps and assertions, no model; and the bug bash (`e2e explore`), where an agent explores | `apps/web/e2e.config.ts`, `apps/web/browser/` (its README) | `pnpm run e2e` |
| esbuild | 0.28 | Bundles the Convex functions on deploy (pinned in `apps/web`) | `apps/web/package.json` | `pnpm run build` |

## Product libraries

| Tool | Version | Job | Used in |
| --- | --- | --- | --- |
| MCP TypeScript SDK (`@modelcontextprotocol/server`, `/client`) | 2.4 | The tool table the `/mcp` route serves, and the e2e clients | `packages/mcp`, `apps/web` |
| zod | 4.6 | Tool input schemas | `packages/mcp` |
| yaml | 2.9 | OKF frontmatter | `packages/core` |
| Next.js | 16.4 | The site, the dashboard, the remote MCP route | `apps/web` |
| React | 19.3 | UI | `apps/web` |
| shadcn/ui + Tailwind CSS | 4.22 / 4.3 | Components and styling | `apps/web` |
| Convex | 1.48 | Database, functions, scheduled indexation, crons | `apps/web/convex` |
| Better Auth (`better-auth`, `@convex-dev/better-auth`, `@better-auth/oauth-provider`) | 1.6.33 / 0.12.6 / 1.6.33 | Dashboard sign-in (email + password, emailed codes) and the OAuth 2.1 authorization server agents sign in through (dynamic client registration, PKCE, RS256 JWTs). Pinned: the Convex component supports Better Auth below 1.7; `patches/` fixes its null matching for refresh tokens | `apps/web/convex/auth.ts`, `convex/betterAuth/` |
| Resend | API | Sign-in and verification codes | `apps/web/convex/email.ts` |
| mcp-handler | 2.3 | The remote MCP endpoint on top of the SDK | `apps/web/src/app/mcp` |
| Stripe SDK | 23.0 | Checkout, the index-credit meter, webhooks | `apps/web/convex/stripe.ts` |
| Vercel AI Gateway | `/v1/evaluate` | Every model call, to one model: Jev (`typesafe-ai/jev`, typed judgments, $0.042 per million input tokens) catalogs and screens. No writing model (the person's agent writes) and no embedding model (search goes by words) | `apps/web/convex/jev.ts`, `indexation.ts`, `libro.ts` |

## Automation

| Tool | Job | Where |
| --- | --- | --- |
| GitHub Actions | CI on every push and pull request: install, lint, typecheck, build, test, plugin (the manifest check), plus a `secrets` job | `.github/workflows/ci.yml` |
| TruffleHog (`trufflesecurity/trufflehog`) | Scans every push, and a pull request's whole history, for committed credentials; a verified or unverifiable find fails CI | the `secrets` job in `ci.yml` |
| Deploy alert | A failed Production deploy (Vercel's deployment status) opens a GitHub issue, which emails the watchers; the next successful deploy closes it | `.github/workflows/deploy-alert.yml` |
| `pnpm/setup@v3`, `actions/checkout@v7` | The actions CI uses. `pnpm/setup` reads the pnpm version from `packageManager` | same file |
| Dependabot | Monthly grouped updates for pnpm (`npm` ecosystem) and the actions | `.github/dependabot.yml` |
| GitHub | `laughing-hermit/librocat` (public: this monorepo, the source of truth) and `laughing-hermit/librocat-status` (the status page) | `gh` |
| Vercel | Hosts `apps/web` as the project `librocat` (root directory `apps/web`, Node 24); production builds run `convex deploy --cmd 'pnpm run build'` | `apps/web/vercel.json`, `vercel link` in `apps/web` |
| Vercel Web Analytics (`@vercel/analytics`) | Page views on every page of librocat Cloud, the dashboard's too, by route (never an id, a search, or a query), plus a few named events with kinds and ranges only; no cookie. $0.03 per 1,000 events on Pro, 2 properties an event | `apps/web/src/components/site-analytics.tsx`, `apps/web/src/lib/analytics.ts` |
| Vercel Speed Insights (`@vercel/speed-insights`) | How fast each route loads and responds for real visitors, by route only, the same way; no cookie. The free tier, which every Vercel plan has with no switch to turn on: 10,000 events in 30 days, then collection pauses, never bills (Plus, $10 a month, is off). It loads from Vercel's `/_vercel/speed-insights/` paths: the first-party base path that serves Web Analytics answers 404 for it | `apps/web/src/components/site-analytics.tsx` |
| Convex (Vercel marketplace) | The project `librocat`: one dev deployment per developer and one production deployment; deploy keys synced to the Vercel project | `pnpm exec convex dev` in `apps/web` |

## What is not in the stack

- bun: removed on 2026-08-20. `bunx` still works for users' installs
  (`plugins`, `add-mcp`, `skills`), the same as `npx`, `pnpm dlx`, and
  `yarn dlx`; it is not a developer tool here.
- eslint, prettier: Biome does both jobs.
- jest, tsup, rollup, webpack: vitest and esbuild cover the two jobs this
  repo has.
- `@types/node` above the 24.x line: held there on purpose to match the Node
  24 runtime pinned in CI and Vercel. Bumping the
  types alone would let code typecheck against APIs the runtime doesn't have.

## The same shape elsewhere

| | librocat | vercel/vercel | supabase/supabase |
| --- | --- | --- | --- |
| Runtime | Node 24 | Node | Node ≥ 22 |
| Packages | pnpm 12 | pnpm 10 | pnpm 11 |
| Tasks | Turborepo | Turborepo | Turborepo |
| Lint / format | Biome | Biome + prettier | eslint + prettier |
| Tests | vitest | vitest | (per package) |
| Bundle | esbuild | esbuild | (per package) |

The public repository is this monorepo itself: the same toolchain, every
package, and the hosted service's code (Next.js, Convex, Stripe).

## Standards and references

The specs librocat implements and the references it follows. When one of
these changes, the code follows it, not the other way around.

| Reference | What it governs in librocat |
| --- | --- |
| [Agent Plugins](https://agent-plugins.org/) | The plugin layout (`plugin.json`, `mcp.json`, `skills/`). Remote servers are `"type": "streamable-http"` with a `url`; OAuth is the host's job, and headers must never carry secrets |
| [Claude Code plugins](https://code.claude.com/docs/en/plugins-reference) | `plugin/.claude-plugin/plugin.json` and the root `.claude-plugin/marketplace.json`, plus the directory listing fields (`displayName`, `icon`, the support, privacy, and terms URLs). `claude plugin validate --strict` checks both |
| [OpenAI plugins](https://developers.openai.com/plugins/build/plugins.md) | Codex and ChatGPT share one plugin directory. Codex reads the portable `plugin/plugin.json` and the root `.agents/plugins/marketplace.json`; the listing lives in `extensions["com.openai"].interface` (30-character name and short description, up to 3 starter prompts, square logo and composer icon). Every MCP tool sets `readOnlyHint`, `destructiveHint`, and `openWorldHint`; `/.well-known/openai-apps-challenge` proves the domain |
| [Cursor plugins](https://cursor.com/docs/reference/plugins) | Cursor loads an Agent Plugin, and reads `plugin/.cursor-plugin/plugin.json` (with its logo) and the root `.cursor-plugin/marketplace.json` for `/add-plugin` with the repository's URL, Import from Repo, and its marketplace |
| [Agent Skills](https://agentskills.io/home) | The `SKILL.md` format of the skills in the plugin, and the `npx skills add laughing-hermit/librocat` path |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | The server and client SDK (v2) behind every MCP surface: the `/mcp` endpoint and the e2e clients |
| [mcp-handler](https://github.com/vercel-labs/mcp-handler) | The remote MCP route on Vercel: stateless Streamable HTTP, `withMcpAuth` (401 + RFC 9728 challenge), the protected-resource metadata |
| [Supabase self-hosting](https://supabase.com/docs/guides/self-hosting) | The model for self-hosting librocat (`self-host/`, SELF_HOSTING.md): Docker Compose, settings in environment variables, community support, and a managed Cloud beside it with a free tier |
| [plugins](https://www.npmjs.com/package/plugins) (Vercel Labs) | `npx plugins add laughing-hermit/librocat`: installs the Agent Plugin (librocat Cloud's MCP entry and the skills) into every detected agent |
| [add-mcp](https://github.com/neon-solutions/add-mcp) (Neon) | `npx add-mcp https://librocat.com/mcp --name librocat -g`: writes the MCP entry into 22 agents' config files, for librocat Cloud or a self-hosted URL |
| [skills](https://github.com/vercel-labs/skills) (Vercel Labs) | `npx skills add laughing-hermit/librocat -g`: copies the Agent Skills from this repository into 79 agents' skill folders |
| [mcp-remote](https://www.npmjs.com/package/mcp-remote) | How an agent that only runs stdio servers reaches librocat's remote MCP, OAuth included |
| [Open Knowledge Format, the announcement](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing) | Why OKF exists: a shared Markdown library that agents read and update, curated like code |
| [OKF SPEC](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) | The storage and export format: frontmatter (`type` required), bundles, `index.md` / `log.md`, links, provenance (`generated`, `verified`, `sources`, `stale_after`) |
| [LLM Wiki (Karpathy)](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) | The pattern librocat productizes: an LLM-maintained wiki with ingest, query, and lint. In librocat: agents `ingest` and `search`; the lint is Libro's review shelf and its weeding report, which agents work with `review_shelf`, `propose`, and `decide` |

### Where librocat lives

| Place | What it is |
| --- | --- |
| [github.com/laughing-hermit/librocat](https://github.com/laughing-hermit/librocat) | This monorepo, Apache-2.0: the code that runs librocat.com |
| [github.com/laughing-hermit/librocat-status](https://github.com/laughing-hermit/librocat-status) | The status page (Upptime), served at `status.librocat.com` |
