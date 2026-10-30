# Security policy

## Report a vulnerability

Email support@librocat.com with "Security" in the subject. Include the steps to
reproduce the problem. Do not open a public issue for a vulnerability.

We acknowledge a report within three business days. We keep you informed
until the fix ships, and we credit you in the release notes if you want.
Please give us 90 days before public disclosure.

## Scope

- This repository: the Agent Plugin, the service's code, and the self-host
  bundle (`self-host/`).
- The hosted service: https://librocat.com, the dashboard, and the remote
  MCP endpoint https://librocat.com/mcp with its OAuth authorization server
  (https://librocat.com/api/auth).

Out of scope: denial of service, social engineering, and problems in a
third-party service (Vercel, Convex, Stripe). Report those to the provider.

## Supported versions

librocat.com as deployed, and `main` for self-hosting. Older commits get
no security fixes.

## Installing

- The Agent Plugin and the agents' own plugin installs read the `plugin/`
  folder of this repository: the MCP entry and the Agent Skills, no code to
  run.
- `npx add-mcp` (Neon) and `npx skills` (Vercel Labs) are third-party
  installers. They only write your agents' config files and skill folders:
  add-mcp the MCP entry, skills the three skills from this repository. Both
  show what they will change and ask first, unless you pass `-y`.

## The hosted service

- Agents authenticate with OAuth 2.1 (dynamic client registration, PKCE,
  consent in the browser). There are no API keys to leak. Access tokens are
  RS256 JWTs bound to `https://librocat.com/mcp`, valid one hour; refresh
  tokens rotate on use. Every call is verified twice (the endpoint and the
  database), and each call checks the user still approves that agent, so a
  disconnect takes effect on the agent's next call.
- Hosting, encryption, access, and data deletion are described at
  https://librocat.com/security.
