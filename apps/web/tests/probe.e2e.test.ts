/**
 * The model check (convex/probe.ts), end to end, against a running stack
 * with the fake AI gateway: what runs Jev, librocat's one model, and one real
 * call to it.
 *   LIBROCAT_E2E_CONVEX_URL=http://127.0.0.1:3210 LIBROCAT_FAKE_GATEWAY=1 pnpm test
 */

import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

const url = process.env.LIBROCAT_E2E_CONVEX_URL;
const run = url && process.env.LIBROCAT_FAKE_GATEWAY === "1" ? test : test.skip;
const cliCwd = process.env.LIBROCAT_E2E_CLI_CWD || new URL("..", import.meta.url).pathname;

// biome-ignore lint/suspicious/noExplicitAny: fixture JSON from the CLI
function runDev(fn: string, args: Record<string, unknown>): any {
  const r = spawnSync("node_modules/.bin/convex", ["run", fn, JSON.stringify(args)], {
    cwd: cliCwd,
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
    encoding: "utf8",
  });
  expect(r.status).toBe(0);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

run("probe:models says what runs Jev, then calls it, and nothing else", () => {
  expect(runDev("probe:models", { calls: false })).toEqual({
    jev: { model: "typesafe-ai/jev", via: "gateway" },
  });
  const checked = runDev("probe:models", {});
  expect(Object.keys(checked)).toEqual(["jev"]);
  expect(checked.jev).toMatchObject({ ok: true });
  expect(checked.jev.judged).toEqual({ postgres: expect.any(Number), mysql: expect.any(Number) });
});

run("every call to Jev asks for zero data retention, from TypeSafe only", async () => {
  const gateway = process.env.LIBROCAT_FAKE_GATEWAY_URL ?? "http://127.0.0.1:8787";
  const before = (await (await fetch(`${gateway}/calls`)).json()) as {
    evaluations: number;
    zdr: number;
  };
  runDev("probe:models", {});
  const after = (await (await fetch(`${gateway}/calls`)).json()) as {
    evaluations: number;
    zdr: number;
  };
  expect(after.evaluations).toBeGreaterThan(before.evaluations);
  expect(after.zdr - before.zdr).toBe(after.evaluations - before.evaluations);
});
