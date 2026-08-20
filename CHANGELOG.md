# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Added

- Shared wikilink tokenization for normal links and embeds, including escaped
  alias delimiters.
- Compatibility fixtures for spaced page paths and duplicate heading slugs.
- Static Dataview support for frontmatter, inline fields, tasks, lists, file
  metadata, DQL query blocks, and inline expressions.
- Static `TABLE`, `LIST`, `TASK`, and `CALENDAR` rendering with `FROM`,
  `WHERE`, `SORT`, `GROUP BY`, `FLATTEN`, and `LIMIT`.
- DataviewJS is explicitly rejected during static builds.

### Fixed

- Page-link URLs now percent-encode route segments such as spaces without
  encoding heading fragments.
- Callout icons now use visible CSP-safe glyphs instead of data-URI masks.

- Escape-aware wikilink tokenization now supports filenames containing escaped
  square brackets.
- Page resolution keeps exact vault-relative paths separate from Rspress route
  aliases, including `foo.md` versus `foo/index.md`.
- Case-insensitive attachment basenames and Markdown page links now participate
  in backlink indexing.

## 0.1.1 - 2026-05-06

### Added

- **Thread-safe slug generation** — replaced shared `GithubSlugger` instance with per-call fresh instances to prevent race conditions in concurrent builds
- **Robust YAML frontmatter parsing** — replaced custom regex parser with `gray-matter`, supporting multi-line values, inline arrays, nested objects, and all standard YAML constructs
- **AST-based transclusion** — transcluded content is now parsed through remark and converted to HTML via rehype, ensuring all markdown syntax (bold, lists, code blocks, etc.) renders correctly inside transclusions
- **`publish: false` frontmatter support** — pages with `publish: false` are excluded from the content index, wikilink resolution, tag pages, and backlinks
- **Live examples page** — added a documentation page that demonstrates all plugin features in action (callouts, wikilinks, tags, highlights, footnotes, transclusion, comments)
- **Complex YAML regression tests** — added test fixtures covering multi-line arrays, inline arrays, and string-to-boolean `publish` coercion

### Fixed

- README version claim now matches `package.json` (0.1.1)
- Documentation navigation now includes Examples and API links

## 0.0.1 - 2026-04-09

Initial release.

### Added

- Obsidian-style wikilink support for Rspress via a remark-based plugin
- Support for `[[Page]]`, `[[Page|Alias]]`, `[[Page#Heading]]`, `[[Page#Heading|Alias]]`, and `[[#Heading]]`
- Strict page resolution with exact path matching and exact unique basename fallback
- Heading resolution for ATX headings, setext headings, and explicit `{#id}` anchors
- Broken-link and ambiguous-link diagnostics with configurable `error` or `warn` behavior
- Cached content indexing to avoid rebuilding the full docs index on every page transform
- Test coverage for parsing, indexing, resolution, malformed links, strict matching, and heading variants
- Example Rspress docs demonstrating wikilink behavior
- Package metadata, MIT license, and release documentation
