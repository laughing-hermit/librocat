/**
 * The app behind an agent, from the name its OAuth client registered with
 * (Claude Code, Cursor, ...): the weekly funnel counts agents by it, and
 * Connect's list of agents shows it. Pure.
 */

/**
 * The apps an agent's registered name can name, in the order they're tried:
 * Claude Code before Claude, since the second matches both.
 */
const APPS: [string[], string][] = [
  [["claude code"], "Claude Code"],
  [["claude"], "Claude"],
  [["codex"], "Codex"],
  [["chatgpt", "openai"], "ChatGPT"],
  [["cursor"], "Cursor"],
  [["copilot", "visual studio code", "vs code", "vscode"], "GitHub Copilot"],
  [["opencode"], "OpenCode"],
  [["antigravity"], "Antigravity"],
  [["gemini"], "Gemini"],
  [["grok"], "Grok"],
  [["openclaw", "mcporter"], "OpenClaw"],
  [["hermes"], "Hermes"],
  [["le chat", "mistral"], "Le Chat"],
  [["librocat"], "librocat"],
];

/**
 * One of the apps librocat knows, else "other": the funnel's email never
 * shows the name itself, which the agent chose.
 */
export function appOf(name: string): string {
  const n = name.toLowerCase();
  return APPS.find(([needles]) => needles.some((x) => n.includes(x)))?.[1] ?? "other";
}

/** What its person sees an agent called: the app, else the name it registered with, short. */
export function appLabel(name: string): string {
  const app = appOf(name);
  if (app !== "other") return app;
  const own = name.trim();
  return own ? (own.length > 40 ? `${own.slice(0, 39)}…` : own) : "An agent";
}
