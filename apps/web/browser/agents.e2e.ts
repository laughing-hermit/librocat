/** Connect an agent, and a second library: create one and switch to it. */

import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { runDev, signIn } from "./support.ts";

test("Connect shows the MCP address and the commands", async ({ app, screen, browser }) => {
  await signIn(browser, "connect", "free");
  await app.open("/dashboard/connect");
  await expect(screen.getByRole("heading", "Connect an agent")).toBeVisible();
  // The four coding agents, each its own way in.
  await expect(screen.getByText("/plugin install librocat@librocat")).toBeVisible();
  await screen.getByRole("tab", "GitHub Copilot").tap();
  await expect(
    screen.getByText("copilot plugin install laughing-hermit/librocat:plugin"),
  ).toBeVisible();
  // The desktop agents, each its own app: each installs the plugin.
  await expect(screen.getByText("Desktop agents")).toBeVisible();
  await expect(screen.getByText(/Customize › Plugins › Add › Add marketplace/)).toBeVisible();
  await expect(screen.getByText(/Then install librocat from it/)).toBeVisible();
  await screen.getByRole("tab", "ChatGPT Desktop").tap();
  // Without a workspace admin, the address: the MCP without the skills.
  await expect(screen.getByText(/Settings › MCP servers › Add server/)).toBeVisible();
  await screen.getByRole("tab", "Grok Bot").tap();
  await expect(
    screen.getByText(/Team Marketplaces › Add Marketplace › Import from Repo/),
  ).toBeVisible();
  await expect(screen.getByText(/adds librocat from Connect apps/)).toBeVisible();
  // Every agent at once, by package manager: the plugin, else MCP + Skills.
  await expect(screen.getByText("npx plugins add laughing-hermit/librocat")).toBeVisible();
  // The plain address: librocat.com on Cloud, the local site here.
  await expect(screen.getByText(/npx add-mcp \S+\/mcp --name librocat -g/)).toBeVisible();
  await screen.getByRole("tab", "pnpm").tap();
  await expect(screen.getByText("pnpm dlx plugins add laughing-hermit/librocat")).toBeVisible();
});

test("a person creates a second library and switches between them", async ({
  app,
  screen,
  browser,
}) => {
  await signIn(browser, "libraries", "individual");
  await app.open("/dashboard/library/new");
  await expect(screen.getByRole("heading", "New library")).toBeVisible();
  await screen.getByLabel("Name").fill("Client work");
  await screen.getByRole("button", "Create library").tap();
  // A second library opens on Connect with every way in, the plugins too;
  // the agent's sign-in asks for its library, this one picked first (below).
  await expect(browser).toHaveURL(/\/dashboard\/connect/, { timeout: 20_000 });
  await expect(screen.getByRole("heading", "Connect an agent")).toBeVisible({ timeout: 20_000 });
  await expect(screen.getByText("/plugin install librocat@librocat")).toBeVisible();
  await expect(screen.getByText(/Customize › Plugins › Add › Add marketplace/)).toBeVisible();
  await expect(screen.getByText("npx plugins add laughing-hermit/librocat")).toBeVisible();
  await expect(screen.getByText(/npx add-mcp \S+\/mcp --name librocat -g/)).toBeVisible();
  await expect(screen.getByText(/library=/)).toBeHidden();
  // The sign-in's consent page asks which library, the open one checked.
  await app.open("/consent?client_id=e2e-no-such-client&scope=openid");
  await expect(screen.getByText(/one of your libraries/)).toBeVisible({ timeout: 20_000 });
  await expect(screen.getByRole("radio", "Client work")).toBeChecked();
  await expect(screen.getByRole("radio", "My library")).toBeVisible();
  await app.open("/dashboard/library");
  await screen.getByRole("button", /Client work/).tap();
  await screen.getByRole("menuitem", "My library").tap();
  await expect(screen.getByRole("button", /My library/)).toBeVisible({ timeout: 10_000 });
  await app.open("/dashboard/connect");
  await expect(screen.getByText("npx plugins add laughing-hermit/librocat")).toBeVisible({
    timeout: 10_000,
  });
});

test("Connect lists your agent: its app, you, its library, and its use today", {
  session: "library",
}, async ({ app, screen, browser }) => {
  await app.open("/dashboard/connect");
  // The agents are on their own tab, the ways to connect first.
  await expect(screen.getByText(/^librocat · /)).toBeHidden();
  await screen.getByRole("tab", /^Connected agents/).tap();
  await expect(browser).toHaveURL(/tab=agents/);
  await expect(screen.getByText(/^librocat · /)).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByText(/· Used today · Since /)).toBeVisible();
  await expect(screen.getByRole("button", "Disconnect")).toBeVisible();
});

test("Connect lists five agents a page, and the next pages the rest", async ({
  app,
  screen,
  browser,
}) => {
  const who = await signIn(browser, "agents-pages", "free");
  runDev("dev:seedAgents", { userId: who.userId, workspaceId: who.workspaceId, count: 12 });
  await app.open("/dashboard/connect?tab=agents");
  await expect(screen.getByText(/^Agent 05 · /)).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByText(/^Agent 06 · /)).toBeHidden();
  // shadcn's Pagination links read as buttons.
  await screen.getByRole("button", "Go to next page").tap();
  await expect(screen.getByText(/^Agent 10 · /)).toBeVisible();
  await expect(screen.getByText(/^Agent 01 · /)).toBeHidden();
  await screen.getByRole("button", "Go to next page").tap();
  await expect(screen.getByText(/^Agent 12 · /)).toBeVisible();
  // Oldest first: none was used, so the first connected leads, from page 1.
  await screen.getByRole("button", "Oldest").tap();
  await expect(browser).toHaveURL(/sort=oldest/);
  await expect(screen.getByRole("button", "Oldest")).toHaveAttribute("aria-pressed", "true", {
    timeout: 10_000,
  });
  await expect(screen.getByText(/^Agent 12 · /)).toBeVisible();
  await expect(screen.getByText(/^Agent 01 · /)).toBeHidden();
});
