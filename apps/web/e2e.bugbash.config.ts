/**
 * The bug bash's config (browser/README.md, "A bug bash"): the suite's
 * config, with the explorers' budgets, three personas, and what this local
 * stack can't do, so `e2e explore` doesn't report it. Repro tests go in
 * browser/bugbash/ until their bug is fixed.
 */
import { web } from "@e2e-dev/web";
import { gateway } from "ai";
import type { E2EConfig } from "e2e";
import base from "./e2e.config.ts";

const shared: E2EConfig = base;
const app = {
  url: process.env.LIBROCAT_E2E_SITE_URL ?? "http://localhost:3000",
  identity: "librocat",
};
const context =
  "librocat is a knowledge base for AI agents. A library holds concepts (Markdown notes with a title, a one-line description, and tags) and kept sources (files and links). The dashboard is read-only for concepts: agents write them over MCP, so there is no button to create or edit a concept, by design. " +
  "This is a local test stack: it sends no email (codes go to a log, so a sign-up cannot be completed here), Checkout answers that payments are not enabled, and model calls go to a stand-in, so cataloging is approximate. The seed data and @example.com accounts are fixtures. " +
  "Never delete the account, and never start a paid run. " +
  "Not bugs: a link that opens a new tab leaves this one unchanged; accessible text splits around inline links, so judge copy by the rendered screen when a screenshot is available and never report split text alone as broken copy; images lazy-load, so scroll and wait before calling one blank.";
const persona = {
  model: gateway("google/gemini-3.8-flash"),
  maxSteps: 40,
  maxModelCalls: 40,
  context,
};

export default {
  ...shared,
  tests: [shared.tests ?? "browser/**/*.e2e.ts", "browser/bugbash/**/*.e2e.ts"].flat(),
  targets: [
    { name: "desktop", engine: web({ viewport: { width: 1280, height: 800 } }), app },
    { name: "phone", engine: web({ viewport: { width: 390, height: 844 } }), app },
  ],
  retries: 0,
  reporters: ["list"],
  agents: {
    default: persona,
    skeptic: {
      ...persona,
      system:
        "Distrust every number, date, count, and claim on screen; cross-check each against every other place it appears.",
    },
    fuzzer: {
      ...persona,
      system:
        "At every input, run the goal's input matrix before anything else, judging each entry before the next. Never take the happy path.",
    },
  },
} satisfies E2EConfig;
