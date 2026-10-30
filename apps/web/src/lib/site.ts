export const site = {
  name: "librocat",
  tagline: "The Open-Source Knowledge Base for AI Agents",
  description:
    "One knowledge base every AI agent shares over MCP, managed by Libro, an AI librarian (and a cat): an LLM wiki in Google's Open Knowledge Format, cataloged, cross-referenced, and kept current with library and information science. librocat Cloud is free to start at librocat.com/mcp. Open source (Apache-2.0): self-host it with Docker, like Supabase.",
  // The landing page's meta description: what a search result shows, in
  // the 160 characters it shows. `description` stays the long one.
  summary:
    "Tell one agent once. Every agent remembers. The open-source knowledge base Claude Code, Codex, Cursor, and Copilot share, kept current by an AI librarian.",
  install: "npx plugins add laughing-hermit/librocat",
  // The public repository: this monorepo.
  repo: "https://github.com/laughing-hermit/librocat",
  // GitHub Releases is the public changelog; a page here would only copy it.
  changelog: "https://github.com/laughing-hermit/librocat/releases",
  // Upptime in github.com/laughing-hermit/librocat-status: checks / and /mcp as
  // often as GitHub's free scheduler runs it, usually every few hours.
  status: "https://status.librocat.com",
  contact: "support@librocat.com",
  // The legal entity that operates librocat and appears on Terms, Privacy,
  // invoices, and Stripe. The product is librocat; the company stays behind it.
  company: "Laughing Hermit, Inc.",
  jurisdiction: "the State of Delaware, USA",
  // The date at the top of Terms, Privacy, Security, and Disclaimer. Change it
  // whenever one of them changes.
  legalUpdated: "October 30, 2026",
  productLine: "librocat is a Laughing Hermit, Inc. product.",
  // The one-line footer/disclaimer truth: what this is at its core.
  atItsCore:
    "At its core, librocat is a library and information science tool for organizing knowledge for AI agents. It stores, catalogs, and retrieves what you put in it. It does not make decisions and is not responsible for the content of your concepts or for actions your agents take. Export or delete your data anytime.",
};

/** The librocat Cloud MCP endpoint. A self-hosted librocat has its own. */
export const MCP_URL = "https://librocat.com/mcp";

/** A URL as one shell word: zsh reads a second library's `?library=` as a pattern, so it's quoted. */
export const shellWord = (url: string) => (url.includes("?") ? `"${url}"` : url);

/** The Agent Skills alone (vercel-labs/skills), for agents without Agent Plugin support. */
export const SKILLS_COMMAND = "npx skills add laughing-hermit/librocat -g";

// Connect, the hero, and the README, in three parts: the four coding agents
// (each its own plugin install), every agent at once with a package manager
// (the plugin where an agent takes Agent Plugins, MCP + Skills where it
// doesn't), and the desktop agents that work on your computer (Claude
// Desktop, the ChatGPT app, Grok Bot).

/** The standards librocat installs with: Connect links each where it names it. */
export const STANDARDS = {
  "Agent Plugins": "https://agent-plugins.org",
  MCP: "https://modelcontextprotocol.io",
  "Agent Skills": "https://agentskills.io",
} as const;

/**
 * The four coding agents librocat focuses on, where the paying teams are:
 * every 2026 survey puts them far ahead of the rest (Stack Overflow's:
 * Claude Code 65.5%, GitHub Copilot 58.7%, Codex 29.5%, Cursor 25.5%, then
 * 16%). Each installs the plugin, skills included, from GitHub its own way,
 * so nothing assumes npm. In the order the hero names the labs: Claude's,
 * ChatGPT's, Grok's (SpaceXAI owns Cursor), then GitHub's.
 */
export const codingAgents = [
  {
    agent: "Claude Code",
    where: "In Claude Code, one after the other:",
    shell: false,
    steps: [
      "/plugin marketplace add laughing-hermit/librocat",
      "/plugin install librocat@librocat",
    ],
    method: "Claude Code plugin",
  },
  {
    agent: "Codex",
    where: "In a terminal, one after the other:",
    shell: true,
    steps: [
      "codex plugin marketplace add laughing-hermit/librocat",
      "codex plugin add librocat@librocat",
    ],
    method: "Codex plugin",
  },
  {
    agent: "Cursor",
    where: "In Cursor's chat:",
    shell: false,
    steps: [`/add-plugin ${site.repo}`],
    method: "Cursor plugin",
  },
  {
    agent: "GitHub Copilot",
    where: "In a terminal, with GitHub's Copilot CLI:",
    shell: true,
    // The plugin's own folder: the repository's root holds the marketplaces.
    steps: ["copilot plugin install laughing-hermit/librocat:plugin"],
    method: "Copilot plugin",
  },
] as const;

/** How each package manager runs a package without installing it. */
export const runners = { npm: "npx", pnpm: "pnpm dlx", yarn: "yarn dlx", bun: "bunx" } as const;

/** Every agent at once with Agent Plugins, with npm: the `plugins` CLI (npmjs.com/package/plugins). */
export const PLUGINS_COMMAND = `${runners.npm} plugins add laughing-hermit/librocat`;

/**
 * Every agent at once, one entry per package manager, both routes:
 * - `plugin`: the `plugins` CLI (npmjs.com/package/plugins) installs the
 *   full plugin (the hosted MCP + skills) into every agent it finds that
 *   takes Agent Plugins: Claude Code, Codex, Cursor, Copilot CLI, VS Code,
 *   Grok Build, Kimi Code. It reaches librocat.com/mcp only.
 * - `mcp` and `skills`: for an agent without Agent Plugins, and for a
 *   self-hosted librocat at its own address: add-mcp
 *   (neon-solutions/add-mcp) writes the server into every agent it finds,
 *   then skills (vercel-labs/skills) adds the skills.
 */
export function everyAgentCommands(url: string = MCP_URL) {
  return Object.entries(runners).map(([pm, run]) => ({
    pm,
    plugin: `${run} plugins add laughing-hermit/librocat`,
    mcp: `${run} add-mcp ${shellWord(url)} --name librocat -g`,
    skills: `${run} skills add laughing-hermit/librocat -g`,
  }));
}

/** librocat's GitHub marketplace, as Claude takes it (owner/repo): its plugin, skills and MCP. */
export const CLAUDE_MARKETPLACE = "laughing-hermit/librocat";

/**
 * The desktop agents that work on your computer, each its own app. A
 * desktop agent gets librocat's skills only with its plugin, never through
 * a bare MCP connector, and the `plugins` CLI reaches none of them. The
 * plugin comes from this repository, as a marketplace, and installing it
 * brings the skills and the MCP together (checked 2026-10-22):
 * - Claude Desktop and Cowork: Customize › Plugins › Add › Add marketplace,
 *   on Pro and Max too, then install librocat and connect its connector
 *   (claude.com/docs/plugins/overview).
 * - ChatGPT's desktop app: a workspace admin imports the repository, then
 *   members install it, or the admin installs it for them; a plugin with
 *   an MCP server works in the desktop app only
 *   (learn.chatgpt.com/docs/enterprise/plugin-management). Without an
 *   admin, `personal`: the address in Settings › MCP servers, the MCP
 *   without the skills (learn.chatgpt.com/docs/extend/mcp).
 * - Grok Bot (xAI's desktop app) installs Cursor's plugins: a Cursor Teams
 *   admin imports the repository as a team marketplace
 *   (cursor.com/docs/plugins), then each member adds librocat from Connect
 *   apps (docs.x.ai/grok-bot); an admin can't add it for them. On your own,
 *   Cursor's marketplace, once librocat is listed.
 * Every library is reachable (its person picks it when the agent signs
 * in), but the plugin reaches librocat.com/mcp only, so a self-hosted
 * librocat takes the address alone (`mcpOnly`): the MCP without the skills.
 */
export const desktopAgents = [
  {
    agent: "Claude Desktop",
    plugin: "In Claude Desktop or Cowork: Customize › Plugins › Add › Add marketplace, with:",
    value: CLAUDE_MARKETPLACE,
    after:
      "Then install librocat from it, and connect its librocat connector on the plugin's Connectors tab: the skills and the MCP, together.",
    mcpOnly:
      "The MCP without the skills, in Claude Desktop: Customize › Connectors › + Add › Add custom connector, then this address:",
    method: "Claude Desktop",
  },
  {
    agent: "ChatGPT Desktop",
    plugin:
      "In the ChatGPT desktop app, a workspace admin opens Admin › Plugins › Add › Import marketplace, with:",
    value: site.repo,
    after:
      "Then members install librocat from Plugins, or the admin sets it to Installed: the skills and the MCP, together.",
    personal:
      "Without a workspace admin, the MCP without the skills: in the desktop app, Settings › MCP servers › Add server, then this address:",
    mcpOnly:
      "The MCP without the skills: in the ChatGPT desktop app, Settings › MCP servers › Add server, then this address:",
    method: "ChatGPT plugin",
  },
  {
    agent: "Grok Bot",
    plugin:
      "Grok Bot installs Cursor's plugins. A Cursor Teams admin opens Dashboard › Plugins & MCPs › Team Marketplaces › Add Marketplace › Import from Repo, with:",
    value: site.repo,
    after:
      "Then each member adds librocat from Connect apps in Grok Bot's sidebar: the skills and the MCP, together. On your own, Cursor's marketplace will have it once librocat is listed.",
    mcpOnly:
      "The MCP without the skills, on your own: ask Grok Bot to add this address as an MCP server:",
    method: "Grok Bot plugin",
  },
] as const;

// Self-hosting, the way Supabase self-hosts: Docker Compose in self-host/.
export const SELF_HOSTING_URL = `${site.repo}/blob/main/SELF_HOSTING.md`;
export const selfHostCommands = [
  `git clone ${site.repo}.git`,
  "cd librocat/self-host && ./setup.sh",
] as const;

export type Interval = "monthly" | "annual";

/**
 * Price per month for each billing interval, in dollars. Annual bills once a
 * year. `perSeat`: the price is per person (Team), not per library.
 */
export type PlanPrice = { monthly: number; annual: number; perSeat?: boolean };

export type Plan = {
  id: string;
  name: string;
  /** A per-interval price for paid plans; a label ("$0", "Custom") otherwise. */
  price: PlanPrice | string;
  cadence: string;
  best: string;
  features: string[];
  cta: string;
  highlighted?: boolean;
  /** Where the CTA goes when it is not Stripe Checkout (Enterprise: email). */
  href?: string;
};

// Pricing. Checkout runs through Stripe (docs/cloud.md). Quotas are stated in
// concepts, not bytes — a concept is the unit users think in. Concepts and
// index credits mirror CONCEPT_QUOTAS, INDEX_CREDITS, and
// INDEX_CREDIT_OVERAGE_CENTS in convex/model.ts. Pay-as-you-go bills credits:
// a concept cataloged spends one, and so does a read of about three pages of
// a file a person adds (convex/fileCatalog.ts; files use at most half).
export const indexOveragePrice = "$0.01 a credit";

/** What credits buy, said the same way on Billing and the pricing grid. */
export const creditsLine = "Libro's credits";

/** Pay-as-you-go's monthly cap, in whole dollars: mirrors PAY_AS_YOU_GO_CAP_CENTS in convex/model.ts. */
export const PAYG_CAP_DOLLARS = { min: 1, max: 1_000 } as const;

// The risk reversal, stated once under the pricing grid and in Billing.
export const riskReversal =
  "Export or delete everything, anytime. Cancel whenever. Your library stays yours.";

// The plans' two units, said once under the pricing grid: what a concept is
// (README "concepts"), what an index credit buys (convex/model.ts
// INDEX_CREDITS), and that pay-as-you-go is opt-in and capped.
export const unitsNote =
  "A concept is one thing your agents saved: a note or a decision. Libro's credits pay for its work: one catalogs a concept that lacks a description or tags, and one reads about three pages of a file you add (files use at most half). Pay-as-you-go past your plan's credits is off until you turn it on, and stops at a cap you set.";

// Prices and tax, stated under the pricing grid and in Billing. Checkout sells
// through Stripe's Managed Payments, where Link is the merchant of record and
// adds the tax (convex/stripe.ts).
export const taxNote =
  "Prices are in US dollars. Sales tax or VAT is added at checkout where it applies.";

// The two paid prices, per month, for each interval. Annual is billed once a
// year (12 × the monthly-equivalent) and saves two months. Stripe holds one
// price object per plan per interval (docs/cloud.md); Team's is per seat, and
// the subscription's quantity is the seats (convex/stripe.ts).
export const PRICES = {
  individual: { monthly: 12, annual: 10 },
  team: { monthly: 15, annual: 12.5, perSeat: true },
} as const satisfies Record<string, PlanPrice>;

/** Team's seats: mirrors MIN_TEAM_SEATS and MAX_TEAM_SEATS in convex/model.ts. */
export const MIN_TEAM_SEATS = 3;
export const MAX_TEAM_SEATS = 100;

/** The Free libraries one person may own: mirrors FREE_LIBRARIES in convex/model.ts. */
export const FREE_LIBRARIES = 1;

/** The libraries one Team covers, on one bill: mirrors TEAM_LIBRARIES in convex/teamCover.ts. */
export const TEAM_LIBRARIES = 10;

/** Dollars, with cents only when there are some: "$12", "$12.50". */
const dollars = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

/** Cents as dollars, the same way: "$10", "$3.12" (pay-as-you-go's spend and cap). */
export const usd = (cents: number) => dollars(cents / 100);

/** "$12" for a monthly-billed plan, "$10" (per month) for an annual one. */
export const priceLabel = (p: PlanPrice, interval: Interval) => dollars(p[interval]);
/** The yearly charge and the saving, for the annual interval: per library, or per person on Team. */
export const annualNote = (p: PlanPrice) =>
  `${dollars(p.annual * 12)} a year, ${p.perSeat ? "per person" : "per library"}`;

export const plans: Plan[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    cadence: "no card needed",
    best: "Try it on your own.",
    features: [
      "1 person, 1 library",
      "1,000 concepts",
      "100 MB of documents and pictures, 50 MB a file",
      "Libro reviews weekly while your agents write",
      "200 of Libro's credits a month, for concepts and your files",
    ],
    cta: "Start free",
    href: "/sign-up",
  },
  {
    id: "individual",
    name: "Individual",
    price: PRICES.individual,
    // Each library carries its own plan (convex/membership.ts).
    cadence: "per library, billed monthly",
    best: "One person, every agent.",
    features: [
      "1 person, 1 library",
      "5,000 concepts",
      "5 GB of documents and pictures, 200 MB a file",
      "Save a link, and watch the pages you cite",
      "500 of Libro's credits a month, then $0.01 each if you turn it on",
    ],
    cta: "Start Individual",
  },
  {
    id: "team",
    name: "Team",
    price: PRICES.team,
    cadence: "per person, billed monthly",
    best: "Every library you own, on one bill.",
    features: [
      // One Team covers its owner's libraries, which share its limits (convex/teamCover.ts).
      `${MIN_TEAM_SEATS} or more people, up to ${TEAM_LIBRARIES} libraries`,
      "Admins, Editors, and Readers: who can change the library",
      "15,000 concepts",
      "25 GB of documents and pictures, 200 MB a file",
      "Save a link, and watch the pages you cite",
      "2,500 of Libro's credits a month, then $0.01 each if you turn it on",
    ],
    cta: "Start Team",
    highlighted: true,
  },
];

/** Enterprise is a conversation, not a card: one line under the grid. */
export const enterprise = {
  line: "Need SSO, custom limits, or a security review?",
  cta: "Talk to us",
  href: "mailto:support@librocat.com",
};

/** Every ceiling, for whoever wants the fine print (docs/cloud.md). */
export const LIMITS_URL = `${site.repo}/blob/main/docs/cloud.md#plans-and-quota`;

/** The dashboard's bar: three places, Settings last. */
export const dashboardNav = [
  { href: "/dashboard/concepts", label: "Library" },
  { href: "/dashboard/connect", label: "Connect" },
  { href: "/dashboard/library", label: "Settings" },
];

/** Connect's header and cards, said once for the page and its loading state. */
export const connectPage = {
  description:
    "Install librocat once. The first time your agent uses it, your browser opens to sign in and pick its library. No keys to copy.",
  /** Its two tabs: how to connect, and who's connected. */
  tabs: { connect: "Ways to connect", agents: "Connected agents" },
  coding: {
    title: "Coding agents",
    description: "Each one installs librocat's plugin, skills included, its own way.",
  },
  desktop: {
    title: "Desktop agents",
    description: "Each one installs librocat's plugin, skills included, in its desktop app.",
  },
  everyAgent: {
    title: "Every agent at once",
    description:
      "With your package manager, in every agent on this computer: the open Agent Plugins standard, else MCP + Agent Skills.",
    // Each standard named here links to its site (STANDARDS).
    plugin: "With Agent Plugins: the plugin, skills included, in every agent that takes them:",
    mcpSkills: "Without Agent Plugins, MCP + Agent Skills: the server, then the skills:",
    mcpSkillsSelfHost: "At this site's address, MCP + Agent Skills: the server, then the skills:",
  },
  agents: {
    title: "Connected agents",
    description:
      "Every agent in your libraries, yours and your teammates'. Disconnect yours, and it signs in again and picks its library.",
  },
} as const;

/**
 * Settings' tabs, each its own page so links from Stripe and the emails keep
 * working (`/dashboard/billing` is Checkout's return URL). They are the
 * library's; your own account is in the user menu, once.
 */
export const settingsNav = [
  { href: "/dashboard/library", label: "General" },
  { href: "/dashboard/team", label: "Team" },
  { href: "/dashboard/billing", label: "Billing" },
];
