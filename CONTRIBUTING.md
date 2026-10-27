# Contributing to librocat

Thank you for helping. librocat is Apache-2.0: the engine, the
Agent Plugin, and the hosted service's code all live in this repository.

## Before you start

- Bugs and ideas: open an issue. Security problems: follow
  [SECURITY.md](./SECURITY.md) instead, never a public issue.
- Larger changes: open an issue first, so we agree on the shape before you
  write it.

## Making a change

1. Fork, branch from `main`, and set up with [DEVELOPERS.md](./DEVELOPERS.md).
2. Keep a change to one purpose. A new format or library-science rule goes
   in `packages/core` (the OKF format, the library, and sources); a
   new tool goes in `packages/mcp/src/tools.ts`, which the MCP endpoint serves.
3. Run `pnpm run lint && pnpm run typecheck && pnpm run build && pnpm test`
   and `pnpm run plugin`. CI runs the same. A change to the hosted service
   also runs `pnpm run e2e`, the end-to-end suites on a throwaway local stack,
   browser tests included ([apps/web/browser](./apps/web/browser/README.md)),
   or the same in CI from Actions, e2e, Run workflow.
4. Open a pull request that says what changed and why. User-facing changes
   get a line in [CHANGELOG.md](./CHANGELOG.md) under Unreleased.

By contributing you agree that your contribution is licensed under the
Apache License 2.0, like the rest of the repository.
