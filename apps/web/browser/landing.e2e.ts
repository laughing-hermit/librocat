/** The public site: the landing page and the legal pages, signed out. */

import { test } from "@e2e-dev/web";
import { expect } from "e2e";

test("the landing page says what librocat is and how to start", async ({ app, screen }) => {
  await app.open("/");
  await expect(screen.getByRole("heading", { level: 1 })).toContainText(
    "knowledge base for AI agents",
  );
  // The product, in pictures: a team's library under the hero.
  await expect(screen.getByRole("img", /^A team's library on Needs you/)).toBeVisible();
  // The coding agents, the way in: one tab each.
  await expect(screen.getByText(/Codex, Cursor, and Copilot all share one library/)).toBeVisible();
  await expect(screen.getByText("/plugin install librocat@librocat")).toBeVisible();
  await screen.getByRole("tab", "Codex").tap();
  await expect(screen.getByText("codex plugin add librocat@librocat")).toBeVisible();
  await screen.getByRole("tab", "Cursor").tap();
  await expect(
    screen.getByText("/add-plugin https://github.com/laughing-hermit/librocat"),
  ).toBeVisible();
  await screen.getByRole("tab", "GitHub Copilot").tap();
  await expect(
    screen.getByText("copilot plugin install laughing-hermit/librocat:plugin"),
  ).toBeVisible();
  // Another agent finds every way to connect.
  await expect(screen.getByRole("link", "See every way to connect")).toBeVisible();
  await screen.getByRole("link", "Pricing", { visible: true }).first().tap();
  await expect(screen.getByRole("heading", "Pricing")).toBeVisible();
  await expect(screen.getByText(/Sales tax or VAT is added at checkout/)).toBeVisible();
});

for (const [path, heading] of [
  ["/terms", /Terms/],
  ["/privacy", /Privacy/],
  ["/security", /Security/],
  ["/disclaimer", /Disclaimer/],
  ["/about", /About|librocat/],
] as const) {
  test(`${path} opens with its heading`, async ({ app, screen }) => {
    await app.open(path);
    await expect(screen.getByRole("heading", { level: 1 })).toContainText(heading);
  });
}

test("every way to connect, in public: coding agents, every agent at once, desktop agents", async ({
  app,
  screen,
}) => {
  await app.open("/connect");
  await expect(screen.getByRole("heading", { level: 1 })).toContainText("Connect an agent");
  await expect(screen.getByText("/plugin install librocat@librocat")).toBeVisible();
  // Every agent at once, by package manager: the plugin, else MCP + Skills.
  await screen.getByRole("tab", "bun").tap();
  await expect(screen.getByText("bunx plugins add laughing-hermit/librocat")).toBeVisible();
  await expect(screen.getByText("bunx skills add laughing-hermit/librocat -g")).toBeVisible();
  await screen.getByRole("tab", "ChatGPT Desktop").tap();
  await expect(screen.getByText(/Admin › Plugins › Add › Import marketplace/)).toBeVisible();
});
