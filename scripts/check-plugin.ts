/**
 * Check the Agent Plugin before it ships: every manifest (Agent Plugins,
 * the plugins CLI's .plugin/ form, Claude Code's, Cursor's) names the same
 * plugin as plugin/plugin.json and none sets a version (agents then update
 * on every commit), every MCP entry (Antigravity's
 * mcp_config.json too) points at the hosted endpoint, each skill is
 * well-formed, and every install path reaches the
 * plugin: the marketplaces of Claude Code, the plugins CLI, Cursor, and Codex
 * (`.agents/plugins/`), and `npx skills add` through the root `skills` link.
 * It also holds the directory listings to their hosts' rules: Agent Plugins
 * 1.0.0's keys, and the limits of ChatGPT's and Codex's directory.
 *
 * Run with: pnpm run plugin
 */

import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const MCP_URL = "https://librocat.com/mcp";
const problems: string[] = [];
const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
};

for (const rel of [
  "plugin/plugin.json",
  "plugin/.plugin/plugin.json",
  "plugin/.claude-plugin/plugin.json",
  "plugin/.cursor-plugin/plugin.json",
]) {
  const m = read(rel);
  check(m.name === "librocat", `${rel}: name is ${m.name}`);
  // A version pins agents to it: Claude Code updates only when it changes.
  check(m.version === undefined, `${rel}: sets a version; agents update on every commit instead`);
}

const mcpEntries: [string, { type?: string; url?: string } | undefined][] = [
  ["plugin/mcp.json", read("plugin/mcp.json").mcpServers?.librocat],
  ["plugin/.mcp.json", read("plugin/.mcp.json").mcpServers?.librocat],
  [
    "plugin/.claude-plugin/plugin.json",
    read("plugin/.claude-plugin/plugin.json").mcpServers?.librocat,
  ],
  [
    "plugin/.cursor-plugin/plugin.json",
    read("plugin/.cursor-plugin/plugin.json").mcpServers?.librocat,
  ],
];
// Antigravity's plugin reads plugin.json, skills/, and this, with its own key.
check(
  read("plugin/mcp_config.json").mcpServers?.librocat?.serverUrl === MCP_URL,
  `plugin/mcp_config.json: the librocat MCP entry's serverUrl must be ${MCP_URL}`,
);
for (const [rel, entry] of mcpEntries) {
  check(entry?.url === MCP_URL, `${rel}: the librocat MCP entry must be ${MCP_URL}`);
  // Agent Plugins headers are plain package data: never a credential.
  check(
    !("headers" in (entry ?? {})),
    `${rel}: no headers on the MCP entry (OAuth is the host's job)`,
  );
}

for (const rel of [
  ".claude-plugin/marketplace.json",
  ".plugin/marketplace.json",
  ".cursor-plugin/marketplace.json",
]) {
  const plugins = read(rel).plugins as { name: string; source: string }[];
  check(
    plugins.length === 1 && plugins[0]?.name === "librocat" && plugins[0]?.source === "./plugin",
    `${rel}: must list the one plugin at ./plugin`,
  );
}
// Codex's marketplace names a source as an object.
const codex = read(".agents/plugins/marketplace.json").plugins as {
  name: string;
  source: { source: string; path: string };
}[];
check(
  codex.length === 1 &&
    codex[0]?.name === "librocat" &&
    codex[0]?.source.source === "local" &&
    codex[0]?.source.path === "./plugin",
  ".agents/plugins/marketplace.json: must list the one plugin at ./plugin",
);

// Agent Plugins 1.0.0 (agent-plugins.org/schemas/1.0.0): plugin.json allows
// these keys only, and both files name their schema.
const SPEC = "https://agent-plugins.org/schemas/1.0.0";
const portable = read("plugin/plugin.json");
const KEYS = [
  "$schema",
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "extensions",
];
for (const key of Object.keys(portable)) {
  check(KEYS.includes(key), `plugin/plugin.json: Agent Plugins has no \`${key}\` key`);
}
check(portable.$schema === `${SPEC}/plugin.schema.json`, "plugin/plugin.json: $schema");
// One description wherever an installer or a directory shows the plugin: the
// manifests and the marketplaces say what plugin/plugin.json says.
for (const [file, description] of [
  ["plugin/.plugin/plugin.json", read("plugin/.plugin/plugin.json").description],
  ["plugin/.claude-plugin/plugin.json", read("plugin/.claude-plugin/plugin.json").description],
  ["plugin/.cursor-plugin/plugin.json", read("plugin/.cursor-plugin/plugin.json").description],
  [
    ".claude-plugin/marketplace.json",
    read(".claude-plugin/marketplace.json").plugins[0]?.description,
  ],
  [
    ".cursor-plugin/marketplace.json",
    read(".cursor-plugin/marketplace.json").plugins[0]?.description,
  ],
  [".plugin/marketplace.json", read(".plugin/marketplace.json").plugins[0]?.description],
]) {
  check(
    description === portable.description,
    `${file}: description differs from plugin/plugin.json's`,
  );
}
const mcp = read("plugin/mcp.json");
check(mcp.$schema === `${SPEC}/mcp.schema.json`, "plugin/mcp.json: $schema");
for (const [name, server] of Object.entries(mcp.mcpServers as Record<string, { type?: string }>)) {
  check(
    ["stdio", "streamable-http", "sse"].includes(server.type ?? ""),
    `plugin/mcp.json: ${name} needs type stdio, streamable-http, or sse`,
  );
}

// An image a directory shows must exist and be square: an SVG by its
// viewBox, a PNG by its header.
function square(rel: string): boolean {
  const file = path.join(root, "plugin", rel);
  if (!fs.existsSync(file)) return false;
  if (rel.endsWith(".svg")) {
    const box = /viewBox="([^"]+)"/.exec(fs.readFileSync(file, "utf8"))?.[1]?.split(/\s+/);
    return box?.length === 4 && Number(box[2]) > 0 && box[2] === box[3];
  }
  const png = fs.readFileSync(file);
  return png.readUInt32BE(16) >= 48 && png.readUInt32BE(16) === png.readUInt32BE(20);
}

// ChatGPT's and Codex's directory (developers.openai.com/plugins): what a
// submission checks.
const listing = portable.extensions?.["com.openai"]?.interface ?? {};
check(
  typeof listing.displayName === "string" && listing.displayName.length <= 30,
  "ChatGPT listing: displayName, 30 characters at most",
);
check(
  typeof listing.shortDescription === "string" && listing.shortDescription.length <= 30,
  "ChatGPT listing: shortDescription, 30 characters at most",
);
const prompts = (listing.defaultPrompt ?? []) as string[];
check(
  prompts.length <= 3 && prompts.every((p) => p.length <= 128 && !p.includes("\n")),
  "ChatGPT listing: at most 3 starter prompts, each one line of 128 characters at most",
);
for (const key of ["websiteURL", "privacyPolicyURL", "termsOfServiceURL"]) {
  check(
    String(listing[key] ?? "").startsWith("https://"),
    `ChatGPT listing: ${key} must be an https URL`,
  );
}
for (const key of ["logo", "composerIcon"]) {
  check(square(listing[key] ?? ""), `ChatGPT listing: ${key} must be a square image in plugin/`);
}
check(
  square(read("plugin/.claude-plugin/plugin.json").icon ?? ""),
  "Claude listing: icon must be a square image in plugin/",
);
check(
  square(read("plugin/.cursor-plugin/plugin.json").logo ?? ""),
  "Cursor listing: logo must be a square image in plugin/",
);
// The listing marks are the site's own.
for (const [asset, site] of [
  ["logo.svg", "logo.svg"],
  ["icon.svg", "logo-head.svg"],
]) {
  check(
    fs.readFileSync(path.join(root, "plugin/assets", asset as string), "utf8") ===
      fs.readFileSync(path.join(root, "apps/web/public", site as string), "utf8"),
    `plugin/assets/${asset} must match apps/web/public/${site}`,
  );
}

check(
  fs.readlinkSync(path.join(root, "skills")) === "plugin/skills",
  "the root `skills` must be a link to plugin/skills (npx skills add looks there)",
);
const skillsDir = path.join(root, "plugin", "skills");
const skills = fs
  .readdirSync(skillsDir)
  .filter((d) => fs.statSync(path.join(skillsDir, d)).isDirectory());
check(skills.length > 0, "plugin/skills has no skills");
for (const skill of skills) {
  const file = path.join(skillsDir, skill, "SKILL.md");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  check(text.startsWith("---\n"), `${skill}/SKILL.md: missing frontmatter`);
  check(new RegExp(`^name: ${skill}$`, "m").test(text), `${skill}/SKILL.md: name must be ${skill}`);
  check(/^description:/m.test(text), `${skill}/SKILL.md: missing description`);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`plugin: ${p}`);
  process.exit(1);
}
console.log(`plugin ok: librocat, ${skills.length} skills, MCP at ${MCP_URL}`);
