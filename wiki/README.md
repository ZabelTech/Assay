# Cairn shared wiki

A curated markdown corpus describing what employers actually look for, by
role / skill / industry. Read by the structurer (#15) at inference time so
extraction can prioritize what the candidate has against what targets
actually demand.

This is plain markdown, versioned in git. No vector DB, no embeddings, no
runtime fetch. The structurer reads the local filesystem.

## Layout

```
wiki/
  README.md            (this file)
  roles/*.md           e.g. staff-platform-engineer.md
  skills/*.md          e.g. distributed-systems.md
  industries/*.md      e.g. fintech.md
```

A page can be cross-cutting (e.g. a skill that's heavily expected of a
specific role, or a role that's typical of a specific industry). Cross-cutting
links live in the frontmatter `related` array; the body does not duplicate
them.

## Page schema

YAML frontmatter (strict, lint-enforced):

```yaml
---
kind: role | skill | industry
slug: matches-filename
updated_at: 2026-05-01
sources:
  - https://example.com/source-one
  - https://example.com/source-two
related:
  - other-page-slug
  - another-page-slug
---
```

- `kind`: one of `role`, `skill`, `industry`.
- `slug`: must equal the filename without the `.md` suffix.
- `updated_at`: ISO date (`YYYY-MM-DD`).
- `sources`: ordered list of URLs. The list is the page's citation registry;
  body sections reference entries by 1-based positional index.
- `related`: list of slugs (no extension, no directory). The linter verifies
  every entry resolves to a real page somewhere under `wiki/`.

Body — loose, lint-suggested headings:

- **Signal** — what concretely indicates the property
- **Corroborating evidence** — what kinds of evidence (per spec §8) typically back it
- **Caveats** — where the demand pattern is contested or shifting

Additional `##` sections are allowed, but every section MUST follow the
per-section sources rule below.

## Per-section sources (mandatory)

Each `##` body section MUST declare which frontmatter `sources` entries back
it via a blockquote on the first non-empty line after the heading:

```markdown
## Signal

> sources: 1, 2

- Bullet one
- Bullet two

## Corroborating evidence

> sources: 2, 3

- Bullet three
- Bullet four
```

- Numbers are 1-based indices into the frontmatter `sources` array.
- Indices may repeat across sections; one section may cite multiple indices.
- Sections without a `> sources: ...` declaration fail the linter.
- An empty `> sources:` declaration (no indices) is rejected.
- If a section genuinely has no source, the section should not exist on a
  knowledge page — move it to the page's PR description.

Section-level granularity is intentional: it catches whole sections fabricated
without backing, while keeping per-page authoring overhead low. Finer-grained
citation (per-bullet) is deliberately out of scope.

## Size discipline — split, don't truncate

A page that grows past ~2000 lines should be split into multiple narrower
pages, cross-linked via `related`. The linter warns when a page exceeds the
soft cap.

Never truncate content to fit a cap. Split instead — e.g. `python.md` becomes
`python.md` + `python-web.md` + `python-data.md` once it gets too broad.
Splitting is a manual operation; the linter only flags the need.

When a page splits, inbound `related` lists in other pages that include the
old slug must be updated to point at the appropriate successor slug(s). The
linter flags broken `related` cross-links, so the inbound-fix is part of the
same PR that does the split.

## Freshness

The linter warns when `updated_at` is older than 12 months. The structurer
also surfaces a "stale wiki page" notice during the review-before-publish
step (#7) when a stale page contributed to one of the drafts.

A "usage longevity" exemption — pages re-validated implicitly by use across
old and new evidence dates — is tracked but not yet acted on; full exemption
logic lands later.

## Integrity rules

- Pages describe what employers ask for. Pages MUST NOT prescribe what
  candidates should claim.
- No aggregate trust signals (spec §10.3.4). Pages do not rank candidates or
  score evidence.
- The frontmatter `sources` list is the canonical citation registry. Every
  body section references it by index via `> sources: ...`. No section
  without sources. No vibes.
- Adjacency is structural (frontmatter `related`), not narrative. The body
  MUST NOT contain a `## Adjacent properties` section; the linter rejects it.

## Linter

```
npm run wiki:check
```

What it enforces:

- Frontmatter schema validation (`kind`, `slug`, `updated_at`, `sources`, `related`).
- `slug` ↔ filename match.
- `related` cross-link integrity (every referenced slug resolves to an existing page).
- Per-section sources: every `##` heading is followed by a non-empty
  `> sources: N, M, ...` declaration on the first non-empty line after the
  heading, and every referenced index resolves to a frontmatter `sources`
  entry.
- Soft-cap warning (~2000 lines per page) suggesting a split.
- Freshness warning at 12 months.
- Rejects any `## Adjacent properties` body section.

The linter is wired into CI as a required check. It also runs as a
pre-commit hook on the local wiki repo (per #17) so candidate-promoted pages
have to pass it before the commit lands.

## Contributing

1. Pick a kind (`role` / `skill` / `industry`) and pick a slug. The slug must
   match the filename and follow DNS-label conventions (lowercase, hyphens
   allowed).
2. Identify your sources first. Every section you write has to cite at least
   one of them. If you can't cite sources, you can't write the section.
3. Write tight. Each section is a few bullets, not paragraphs.
4. Run `npm run wiki:check` before opening the PR.
5. If your page exceeds the soft cap, split it.
