/**
 * The browser suite (browser/, TesterArmy's e2e): the app in Chromium, as a
 * person uses it, on the throwaway stack `pnpm run e2e` starts. Its tests use
 * exact steps (locators), so they call no model. The agent below is for the
 * bug bash (`e2e explore`), through the Vercel AI Gateway with the Vercel
 * OIDC token in .env.e2e.local (`vercel env pull .env.e2e.local`).
 * browser/README.md has the rest.
 */

import { web } from "@e2e-dev/web";
import { gateway } from "ai";
import type { E2EConfig } from "e2e";

try {
  process.loadEnvFile(".env.e2e.local");
} catch {
  // No token: fine for the tests; `e2e explore` needs one.
}

// One identity whatever port the site got, so saved sessions match.
const app = {
  url: process.env.LIBROCAT_E2E_SITE_URL ?? "http://localhost:3000",
  identity: "librocat",
};

const context =
  "librocat is a knowledge base for AI agents. A library holds concepts (Markdown notes with a title, a one-line description, and tags) and kept sources (files and links agents keep). " +
  "The dashboard's sidebar has Overview, Concepts, Sources, Connect, Team, and Billing, and the library switcher at its top. " +
  "This is a local test stack: it sends no email (codes go to a log), and Checkout answers that payments are not enabled. " +
  "Never delete an account, a library, or an index unless the goal says to.";

export default {
  projectId: "librocat",
  targets: [
    { name: "desktop", engine: web({ viewport: { width: 1280, height: 800 } }), app },
    { name: "phone", engine: web({ viewport: { width: 390, height: 844 } }), app },
  ],
  tests: ["browser/**/*.e2e.ts"],
  agents: { default: { model: gateway("google/gemini-3.8-flash"), context } },
} satisfies E2EConfig;
