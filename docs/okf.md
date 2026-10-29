# OKF in librocat

librocat stores knowledge as [Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md)
(OKF v0.2) files: Markdown with a YAML frontmatter block.

## A concept

```markdown
---
type: Decision            # the only required field
title: Use Postgres for the orders service
description: One actionable sentence.
tags: [database, orders]
status: stable            # draft | stable | deprecated (default: stable)
supersededBy: decisions/use-postgres-v2   # librocat extension: a "see" reference, set by `update superseded_by`
---

# Body
Front-load the answer. Link related concepts: [index layer](/architecture/index-layer.md).
```

## Ids and paths

The concept id is the file's bundle path without `.md`. librocat appends `.md` when
writing, so ids that contain dots round-trip (a Python file `code/index.py` is
stored at `code/index.py.md` and keeps the id `code/index.py`).

### Shelves: one library, many projects

The leading directory of an id is its **shelf** (`acme/auth-flow` sits on the
`acme` shelf). A library stays one connected whole (one thesaurus, one graph,
one weeding report), and projects are shelves in it. `search` and `list`
take `shelf: "acme"` to scope a read to one project, and an agent working in
that project searches its shelf first and the whole library second. Every
shelf gets its own finding aid (`index.md`). Do not split a library into
several to get per-project views; that is what a shelf is for. Split only
when access must differ (a client under NDA, personal vs employer): that is
a second library, which an agent reaches when you pick it at its sign-in.

## Links become the graph

Only Markdown links to `.md` targets become graph edges:

- `/path/from/bundle.md` — bundle-relative
- `./sibling.md`, `../up.md` — relative to the concept

External URLs and anchors are ignored. `get_concept`'s `links` and `graph` see
exactly the links you write, so link generously.

## Reserved files

`index.md` and `log.md` are reserved (directory listing and update log). They are
not indexed as concepts, and Import skips them. librocat keeps the ids of
deleted and renamed concepts per library, and the export writes them as the
bundle-root `log.md`, under date headings, newest first:

```markdown
## 2026-09-26

* **Deletion**: `notes/old` — Old title
* **Rename**: `notes/a` → `notes/b`
```

A retired id is never handed to a new concept by default (docs/mcp-tools.md,
"Ids are never reused by default").

## Dublin Core, roughly

OKF frontmatter maps nearly one-to-one onto [Dublin Core](https://www.dublincore.org/specifications/dublin-core/dces/),
the fifteen-element library metadata standard: `title` → dc:title,
`description` → dc:description, `tags` → dc:subject, `type` → dc:type, links →
dc:relation. The format is a hand-authorable catalog record, not an invented
schema. (The one element OKF lacks is dc:date: librocat stamps `created_at`/`updated_at` and keeps a revision per write.)

## Leniency

Parsing is lenient per the spec: unknown frontmatter keys are preserved, unknown
types are treated as generic concepts, and a file that fails to parse is skipped
rather than aborting the load.
