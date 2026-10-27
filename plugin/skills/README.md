# Agent Skills

The librocat Agent Skills, following the [Agent Skills Standard](https://agentskills.io).
They live here, inside the Agent Plugin (`plugin/`); the repository's root
`skills` links to this folder so `npx skills add laughing-hermit/librocat` finds
them too.

- **`librocat-write`**: what belongs in the library and how to write it:
  one concept per idea, the two concept types (Note and Decision), and a complete catalog
  record (title, description, tags from the thesaurus, sources, review
  date). What "remember this" loads.
- **`ingest-document`**: attach a document, a picture, a web page, a video
  or podcast (from its transcript, with timestamps), or a code repository,
  then write the concepts that cite it. A recording is kept as its
  transcript: librocat keeps text and pictures only.
- **`knowledge-review`**: work Libro's review shelf with the person, weed,
  add the concepts a codebase lacks, and ship the library as a PR.

Each is a folder with a `SKILL.md` (name + description + instructions). Agents
load the name/description first and read the full file only when a task matches.
