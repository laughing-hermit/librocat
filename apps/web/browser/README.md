# Browser tests

librocat in Chromium, as a person uses it, with
[TesterArmy's e2e](https://github.com/tester-army/e2e). The tests use exact
steps (`screen.getByRole("button", "Save link").tap()`) checked by exact
assertions, as TesterArmy advises when the action is known: they call no
model, need no token, and run the same every time. Agents are for finding
what nobody wrote a test for: the bug bash below.

## Run them

`pnpm run e2e` runs this suite after the others, on its throwaway stack, on
the desktop target, with `--strict-cache`: an agent step added to a test
fails rather than reaching a model. Phone layouts are checked by resizing
inside desktop tests (`regressions.e2e.ts`) and by `--tag screens`.

To work on a test against a running stack:

```bash
E2E_SERVE=1 pnpm run e2e       # prints the URLs and env to use; Ctrl-C stops it
cd apps/web && LIBROCAT_E2E_CLI_CWD=… LIBROCAT_E2E_SITE_URL=… LIBROCAT_E2E_CONVEX_LOG=… \
  pnpm exec e2e run browser/billing.e2e.ts --target phone
```

## How the tests work

- Each test makes its own people (`support.ts` `person`, `signIn`): a verified
  user on a plan, signed in over HTTP, its cookie handed to the browser. No
  password is typed on screen, which would hide the screen from the model.
- `seedConcepts` writes concepts the way an agent does (the MCP's `ingest`).
- The stack "emails" codes to the Convex log; `emailedCode` reads them.
- `sessions.e2e.ts` saves signed-in sessions (`free`, `individual`, `team`,
  and `library` with concepts) for `e2e explore --session`.
- `regressions.e2e.ts` holds the bug bash's findings, each a test that failed
  before its fix.

## Screenshots for a review

```bash
pnpm exec e2e run --tag screens       # every page, desktop and phone
```

The pictures land in `apps/web/.e2e/artifacts/<target>/`.

## A bug bash

`npx e2e guide bug-bash` has the method: charters (one area, one posture
each) run with `e2e explore`, findings triaged, and every confirmed bug
proven by a test that fails until it is fixed. `apps/web/e2e.bugbash.config.ts`
holds the explorers' budgets and personas (`default`, `skeptic`, `fuzzer`).
Explorers call a model (`google/gemini-3.8-flash`) through the Vercel AI
Gateway, with the project's Vercel OIDC token (it lasts about 12 hours):
`cd apps/web && vercel env pull .env.e2e.local`. Give each charter a session
from `sessions.e2e.ts`, and set `E2E_TELEMETRY_DISABLED=1`:

```bash
pnpm exec e2e explore "Starting at /dashboard/billing, …" --config e2e.bugbash.config.ts \
  --session library --agent skeptic --output .e2e/bugbash/billing --max-steps 6
```

The first one (2026-10-04) ran eight charters for about $1.40 and found the
nine bugs in `regressions.e2e.ts`.
