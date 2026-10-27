# Self-hosting librocat

librocat is open source, all of it, under Apache-2.0: librocat Cloud at
librocat.com runs this repository. Self-hosting runs the same site,
dashboard, and MCP on your own machine or server with Docker, on a
self-hosted Convex backend, with `LIBROCAT_SELF_HOST=1`: no plans, no quotas,
no billing. It's modeled on
[Supabase's self-hosting](https://supabase.com/docs/guides/self-hosting):
Docker Compose, settings in environment variables, and support from the
community (GitHub issues and discussions).

So there are two free ways to run librocat: **librocat Cloud's free plan**,
managed for you, or **self-hosting**, run by you. The paid Cloud plans stay
managed for you and add more room, a team's shared library, the reading list
and source watch, and Libro's report every week (Free gets it once a month).
A self-hosted librocat has all of that with no limits, on your own server.

## Before you start: what makes it work well

Your agent (Claude Code, Codex, Cursor, …) is the System Two: it reasons,
reads, writes, and searches. librocat adds one model of its own, for what an
agent can't do alone across a whole library: a **System One**, for fast,
typed judgments (yes or no, one of a set, a score). It catalogs what an agent
left blank, confirms duplicates and review dates, and checks your agent's
merge drafts. Search needs no model: it goes by words, through your
library's thesaurus, and your agent writes the searches and tries other
words when the first ones miss.

librocat Cloud runs Jev, from TypeSafe. With Jev, a self-hosted librocat
works like Cloud: `AI_GATEWAY_API_KEY` runs it through the Vercel AI
Gateway, or `TYPESAFE_API_KEY` from TypeSafe itself. An open-source one on
your own machine works, but measures lower: on librocat's own judgments, Von
gets 39% right and Jev 92% ([Models](#models-bring-your-own)). With no model
at all, your agent still writes complete concepts, and search works the
same.

## What runs

| Service | What it is | Port |
| --- | --- | --- |
| `convex` | The Convex backend: database, functions, HTTP actions | 3210, 3211 |
| `deploy` | One-shot: pushes librocat's functions and settings, then exits | none |
| `web` | The site, the dashboard, and the remote MCP at `/mcp` | 3000 |
| `dashboard` | Optional: Convex's own dashboard (data, logs, settings) | 6791 |

The ports are published on this machine only (`127.0.0.1`).

## Start

You need Docker with Compose v2, or Podman with `podman compose`. You also
need git, openssl, and about 2 GB of memory.

```bash
git clone https://github.com/laughing-hermit/librocat.git
cd librocat/self-host
./setup.sh          # with Podman: COMPOSE="podman compose" ./setup.sh
```

`setup.sh` does the following, and is safe to run again:
1. on its first run, starts `self-host/.env` from
   [`.env.example`](self-host/.env.example), then writes the secrets to it;
2. starts Convex and takes its admin key;
3. builds the image;
4. deploys the functions;
5. starts the site.

The first build takes a few minutes. Keep `.env`: it's the key to your data.

Then:

1. **Open http://localhost:3000 and create an account.** No email service is
   set up yet, so the verification code goes to the function log. Run
   `./logs.sh --history 100` and look for "verification code".
2. **Connect your agents** to `http://localhost:3000/mcp`, with any agent
   you use (Claude Code, Codex, Cursor, GitHub Copilot, and more):

   ```bash
   npx add-mcp http://localhost:3000/mcp --name librocat -g
   npx skills add laughing-hermit/librocat -g
   ```

   That adds the MCP server to your agents and installs librocat's Agent
   Skills. For Antigravity, copy the plugin (`npx giget
   gh:laughing-hermit/librocat/plugin ~/.gemini/config/plugins/librocat --force`),
   then set `serverUrl` in its `mcp_config.json`. By hand instead: `claude mcp add --transport http librocat
   http://localhost:3000/mcp`. The dashboard's Connect page shows the same
   MCP + Skills commands with your server's address, and that address for a
   desktop agent's custom connector (librocat's plugin reaches librocat Cloud
   only). On its first call, the agent opens your browser to sign in and
   approve it. Use `localhost`, not `127.0.0.1`: the address is part of
   every token.
3. **Add a model (optional).** librocat works best with Jev, which catalogs
   and runs Libro's screens. Set it in `.env`
   ([Models](#models-bring-your-own)), run `docker compose up -d --build`,
   then check it with `./models.sh`.

## Settings

Set these in `self-host/.env`, then apply them with `docker compose up -d
--build`.

| Variable | What it does |
| --- | --- |
| `AUTH_RESEND_KEY` | Email sign-up and password codes through [Resend](https://resend.com). Unset: codes go to the log. |
| `AI_GATEWAY_API_KEY`, `TYPESAFE_API_KEY`, `LIBROCAT_JEV_URL`, ... | The System One model (Jev, or one of your own): see [Models](#models-bring-your-own) below. Unset: no model is called. |
| `LIBROCAT_PORT` | The site's port on this machine (default 3000). |
| `LIBROCAT_SITE_URL` | The address people and agents use (default `http://localhost:$LIBROCAT_PORT`). An agent that connects from its vendor's cloud, like a custom connector in Claude Desktop or ChatGPT, reaches only a public `https` one. |
| `CONVEX_CLOUD_ORIGIN`, `CONVEX_SITE_ORIGIN` | Where browsers reach Convex (default `http://127.0.0.1:3210` and `:3211`). |
| `LIBROCAT_BIND` | The interface the ports are published on (default `127.0.0.1`). |
| `LIBROCAT_FETCH_PRIVATE` | `1` lets the reading list and source watch fetch pages on private addresses (your own network, an intranet wiki). Off by default: librocat fetches public pages only. |

## Models: bring your own

librocat's server uses one model, a System One, which composes no text of
its own: your agents (Claude Code, Codex, opencode, or any other) write the
concepts, their descriptions and tags, and the merges, with the model they
already use, and they do the searching. librocat's model fills in a
description or tags an agent left out, by picking from what the concept and
your vocabulary already say, and does what an agent can't do alone across a
whole library. It works best with Jev, runs with an open-source model or
none, and can be online or on your own machine:

| Model | What it does | librocat Cloud runs | Without it |
| --- | --- | --- | --- |
| **System One** | Typed judgments (yes or no, one of a set, a score) instead of text: [TypeSafe](https://typesafe.ai)'s Jev, or an open-source model on a server of your own. It catalogs a concept an agent left blank, picking a description from its own sentences and tags from your vocabulary. It confirms duplicates, suggests review dates, and checks the merges your agent drafts. | Jev | A concept an agent leaves blank stays blank. Jev's screens are off: the duplicates it confirms, review dates, and merge-draft checks. |

Your agents read and write the library with no model at all, and can write
complete concepts, with a title, a description, and tags. Search needs no
model either: it goes by words, stemmed and expanded through your thesaurus,
with matches in a concept's title, description, and tags counting twice, and
it finds kept sources by their text and their title (docs/architecture.md,
"Search").

librocat Cloud runs Jev through the Vercel AI Gateway, and its users don't
choose. Self-hosted, you choose in `.env`, whose Models section lists the
options, then run `docker compose up -d --build`. Compose reads your shell's
variables before `.env`: if your shell exports `AI_GATEWAY_API_KEY` or
`TYPESAFE_API_KEY`, unset it first for a server that shouldn't use it.

### Three ways to run it

- **Online.** Jev from a provider: with only `AI_GATEWAY_API_KEY`, it's
  librocat Cloud's pipeline; or Jev from TypeSafe, with `TYPESAFE_API_KEY`.
  Example: Claude Code driving your librocat on a server.
- **Offline.** An open-source System One on your machine, or none. Nothing
  leaves it after the first downloads:

  ```bash
  docker compose --profile systemone up -d --build
  ```

  with the `systemone` settings from `.env.example`. librocat then calls out
  only for what you turn on: email, and the reading list's and source
  watch's page fetches. Your agent can be local too: opencode on a model
  Ollama serves on your machine, connected with
  `npx add-mcp http://localhost:3000/mcp --name librocat -g -a opencode` and
  `npx skills add laughing-hermit/librocat -g -a opencode`.
- **Hybrid.** Your agent and librocat's model are separate choices. For
  example: Claude Code with an offline librocat; or opencode on a local
  model with librocat Cloud, or with your own librocat running Jev.

### The System One model: Jev, or an open-source one

Choose one:
- **Jev through the Vercel AI Gateway:** set `AI_GATEWAY_API_KEY`.
- **Jev from TypeSafe:** set `TYPESAFE_API_KEY`, a key from
  [TypeSafe's console](https://console.typesafe.ai/keys). librocat calls
  TypeSafe's API directly, with no Vercel account.
- **An open-source one, on a server of your own:** set `LIBROCAT_JEV_URL` to
  any server that speaks TypeSafe's `/v1/systemone`. The `systemone` profile
  runs [Von](https://github.com/wfzyx/von) (Apache-2.0) on the CPU at
  `http://systemone:8000/v1`. On a GPU, [Kev](https://github.com/jaredpalmer/kev)
  and [OpenJev](https://github.com/razorback16/openjev) speak the same API.
  `LIBROCAT_JEV_KEY` if the server wants one, and `LIBROCAT_EVAL_MODEL` to
  name its model (Von's is `von-latest`), which the concepts it catalogs
  record.
- **None:** set none of them. Its judgments are off: cataloging, review
  dates, the duplicates Jev confirms, and merge-draft checks. Your agents
  still write complete concepts, the mechanical review still fills the
  shelf, and search works the same.

How well each did librocat's jobs on 2026-09-29, on librocat's own labeled
questions (44 judgments: cataloging, duplicates, review dates, and merge
drafts, plus two jobs since dropped, unanswered questions and the reference
desk), scored at the product's own thresholds, three runs each:

| System One | Right | Time |
| --- | --- | --- |
| Jev, through the gateway | 121 of 132 (92%) | 2.3 s for all 44 |
| Von 1.3 on a 16-core laptop CPU (the `systemone` profile) | 51 of 132 (39%) | about 2.5 minutes for all 44, 5 to 15 s a request; once, a 10-question request ran past the 2-minute limit |

Score your own with `./models.sh judge`. On a CPU, today's open-source
System One models are far below Jev: they run, but a judgment that often
wrong does more harm than none, so for quality use Jev, or a larger open
model on a GPU, and check it. An LLM doesn't stand in for any of them: we
measured one (qwen2.5:3b) in Jev's place, and it was right about half the
time.

With several set, `LIBROCAT_JEV` (`local`, `gateway`, `typesafe`, or `off`)
decides; unset, a server of your own comes first, then TypeSafe's key, then
the gateway's. With `TYPESAFE_API_KEY`, `LIBROCAT_EVAL_MODEL` names a Jev
version (default `jev-latest`); through the gateway, a gateway model (default
`typesafe-ai/jev`).

### Check it

```bash
./models.sh
```

It says what runs the System One, calls it once, and says why the call
failed, with what to check: the key, the model's name and the URL, a server
Convex can't reach, or a local model still loading. The check asks whether
a test concept says its database runs Postgres, which it does, and MySQL,
which it doesn't (`judged`): near 1 and near 0 is right. `./models.sh
judge` scores it on librocat's own questions (above). The dashboard's Home
shows what runs it too, and every deploy prints it (`docker compose logs
deploy`).

### Attached files

Files attached to a self-hosted library (the dashboard's Library › Sources, or an
agent's upload through `add_source`) are kept by your Convex backend, in
its volume, with no caps. librocat keeps text and pictures: audio, video, and
other files are refused at upload, with what to attach instead (a
recording's transcript). librocat reads their text where code can (text,
HTML, PDF, Word, and the other office documents: Excel and OpenDocument
spreadsheets as CSV, PowerPoint and OpenDocument slides with their notes,
OpenDocument text, RTF, and EPUB), with no model, and search finds a file
by that text and by its title. A picture or a scanned PDF has no text to
read: it's found by its title, and by the concepts your agent writes about
it. A picture in HEIC, WebP, GIF, AVIF, TIFF, or SVG gets a JPEG copy, kept
beside the original, so the dashboard and `get_source` can show it. sharp
makes the copy, and your Convex backend installs it on deploy
(`apps/web/convex.json`); `./models.sh files` checks that it works. Files
over 200 MB are kept but not read.

### Your agent's subscription

librocat's server needs no writing model: your agent (Claude Code, Codex,
Cursor, ...) does the writing, on its own sign-in and subscription, and
connects to your librocat as to Cloud. A Claude Code or Codex subscription
can't serve as librocat's model: those sign-ins are for the person using
the agent, and librocat's jobs run unattended, on a server.

## On a server, with a domain

Put a reverse proxy with TLS in front, such as Caddy or nginx on the same
host. It needs three names:
- the site, to port 3000;
- Convex, to port 3210;
- Convex's HTTP actions, to port 3211.

For example, in `.env`:

```bash
LIBROCAT_SITE_URL=https://kb.example.com
CONVEX_CLOUD_ORIGIN=https://convex.kb.example.com
CONVEX_SITE_ORIGIN=https://auth.kb.example.com
```

Then run `docker compose up -d --build`; the addresses are built into the
site.

The site's server reaches Convex at those same public addresses, so the
server must be able to resolve them.

Anyone who can reach the site can create an account and a library of their
own. People join a shared library through a Team invite link. If you don't
want open sign-up, keep the site on a private network, or put your proxy's
own login in front of it.

## Run it

- **Logs:**
  - `./logs.sh` for the Convex functions (Ctrl+C to stop);
  - `docker compose logs web` for the site.
- **Convex's dashboard:** run `docker compose --profile admin up -d`, then
  open http://localhost:6791 and paste `CONVEX_ADMIN_KEY` from `.env`.
- **Backups:** everything lives in the `convex-data` volume. To take a
  snapshot:

  ```bash
  docker compose run --rm --no-deps -v "$PWD/backups:/backups" deploy \
    sh -c 'cd apps/web && node_modules/.bin/convex export --path /backups/librocat.zip'
  ```

  `convex import` restores one. The dashboard's Export also gives each
  library as plain OKF files.
- **Upgrade:** `git pull && docker compose up -d --build`. The deploy step
  pushes the new functions.
  - From a version with an embedding model: the deploy removes the
    `LIBROCAT_EMBED_*` settings it had set, so delete those lines from
    `.env` too. If you ran the `ollama` or `embed-vl` profile,
    `docker compose up -d --build --remove-orphans` stops its container,
    and this frees its downloads:

    ```bash
    docker volume rm librocat_ollama-data librocat_embed-vl-data
    ```
- **Stop:**
  - `docker compose down` keeps the data;
  - `docker compose down -v` deletes it.

## Move between self-hosted and librocat Cloud

A library moves as OKF files, either way, through the dashboard:

1. On the one you leave, Export, in Settings: the library part (every
   concept and the kept sources' text), then each file part (the attached
   files, about a gigabyte each, in `okf/_sources/files/`).
2. On the other, Import, in Settings, with all those zips at once. Any
   size: your browser reads them, and each concept, source, and file goes
   through the usual limits.
3. Point your agents at the new URL with the MCP + Skills commands
   (librocat Cloud's here; for your server, its own):

   ```bash
   npx add-mcp https://librocat.com/mcp --name librocat -g
   npx skills add laughing-hermit/librocat -g
   ```

Revisions stay behind: the files carry each concept as it is now.

## How it differs from librocat.com

- There is no billing and there are no quotas.
- You choose the model, or none ([Models](#models-bring-your-own)).
- Libro is the same: the weekly mechanical review, and with Jev, its
  screens (duplicates, review dates, and merge-draft checks). Your agents
  work its shelf, here as on Cloud.
- Convex runs on SQLite in the volume. For Postgres, S3, or several
  machines, see [Convex's self-hosting guide](https://github.com/get-convex/convex-backend/tree/main/self-hosted)
  and add its settings to the `convex` service.
