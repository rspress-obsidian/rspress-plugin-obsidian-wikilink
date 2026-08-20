# rspress-plugin-obsidian-wikilink

[![npm version](https://img.shields.io/npm/v/rspress-plugin-obsidian-wikilink?logo=npm)](https://www.npmjs.com/package/rspress-plugin-obsidian-wikilink)
[![npm downloads](https://img.shields.io/npm/dm/rspress-plugin-obsidian-wikilink)](https://www.npmjs.com/package/rspress-plugin-obsidian-wikilink)
[![license](https://img.shields.io/github/license/Jacob-Valor/rspress-plugin-obsidian-wikilink)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/Jacob-Valor/rspress-plugin-obsidian-wikilink/ci.yml?branch=main&logo=github)](https://github.com/Jacob-Valor/rspress-plugin-obsidian-wikilink/actions)
[![last commit](https://img.shields.io/github/last-commit/Jacob-Valor/rspress-plugin-obsidian-wikilink?logo=git)](https://github.com/Jacob-Valor/rspress-plugin-obsidian-wikilink/commits/main)
[![Bun](https://img.shields.io/badge/Bun-000?logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![semantic-release](https://img.shields.io/badge/semantic--release-ff69b4?logo=semanticrelease)](https://github.com/semantic-release/semantic-release)

Obsidian-style wikilinks for Rspress. Write your docs in Obsidian, publish with Rspress.

## Features

| Syntax | Description |
|--------|-------------|
| `[[Page]]` | Link to another page |
| `[[Page\|Alias]]` | Link with custom display text |
| `[[Page#Heading\|Alias]]` | Link to heading with alias |
| `[[#Heading]]` | Link to heading in current page |
| `[[## heading]]` | Vault-wide heading search (resolves when unique) |
| `[[^^block-id]]` | Vault-wide block search (resolves when unique) |
| `[[Page#^block]]` | Block reference (standalone or inline) |
| `![[Page]]` | Transclude full page content |
| `![[Page#Heading]]` | Transclude a specific section |
| `![[Page#^block]]` | Transclude a specific block |
| `![[image.png\|300x200]]` | Embed media with optional size |
| `[Label](Page.md)` | Standard markdown links resolved like wikilinks (default on) |
| `![alt](note.md)` | Markdown embed form — transcludes like `![[note]]` |
| `#tag` | Tag links (opt-in) |
| `> [!note]` | Callouts with aliases + foldable state (opt-in) |
| `%% comment %%` | Obsidian comments — stripped from output |
| `==highlight==` | Text highlighting (including callout titles) |
| `[^1]` | Footnotes with definitions |
| `- [ ] task` | Task lists (native Rspress) |
| Dataview query blocks | Static DQL tables, lists, tasks, and calendars (opt-in) |
| Daily Notes | Date expansion and previous/current/next navigation (opt-in) |
| Backlinks panel | Auto-generated per page (opt-in) |


## Compatibility scope
This plugin targets **static Obsidian-flavored Markdown** published through Rspress. It
supports wikilinks (and their standard markdown `[Label](Page.md)` equivalents),
heading and block references, unique vault-wide search links, transclusion, media
embeds, callouts, comments, highlights, tags, footnotes, selected frontmatter fields,
backlinks, opt-in static Dataview DQL, and static Daily Notes date expansion.

Static Dataview evaluates query blocks during the Rspress build. It supports
`TABLE`, `LIST`, `TASK`, and `CALENDAR` queries with `FROM`, `WHERE`, `SORT`,
`GROUP BY`, `FLATTEN`, `LIMIT`, frontmatter fields, inline fields, file metadata,
tags, links, tasks, and common scalar functions. DataviewJS uses a restricted
compatibility API; arbitrary host access and unrestricted JavaScript are rejected.

Static Daily Notes recognizes date-formatted filenames, expands `{{date}}`,
`{{date:FORMAT}}`, and date offsets such as `{{date+1d}}`, and can render
previous/current/next navigation. It does not create files or emulate the
interactive Obsidian Daily Notes command.

It does not emulate Obsidian's application runtime. Canvas files, workspace
navigation, graph views, community-plugin code, and editor-only features are
outside the static Markdown pipeline.

The supported static syntax matrix is:

| Capability | Parser/index | Resolver | End-to-end HTML |
|---|---:|---:|---:|
| Page links and aliases | Yes | Yes | Yes |
| Relative paths | Yes | Yes | Yes |
| Heading and block links | Yes | Yes | Yes |
| Current-page links | Yes | Yes | Yes |
| Vault-wide searches | Yes | Yes | Yes |
| Markdown links (`[x](Page.md)`) and embeds | Yes | Yes | Yes |
| Page and section transclusion | Yes | Yes | Yes |
| Media embeds | Yes | Yes | Yes |
| Callouts | Yes | N/A | Yes |
| Tags and backlinks | Yes | Yes | Yes |
| Footnotes and highlights | Yes | N/A | Yes |
| Static Dataview DQL | Yes | Yes | Yes |
| Daily Notes | Yes | N/A | Yes |
| Frontmatter metadata | Yes | Yes | Yes |
| Broken and ambiguous diagnostics | Yes | Yes | Yes |

Callouts, footnotes, and highlights are syntax transformations rather than page
target resolution, so a resolver test is not applicable to those capabilities.
The compatibility fixtures cover Unicode, punctuation, duplicate headings,
duplicate page names, nested folders, explicit relative paths, and missing
targets.

Path resolution preserves exact vault-relative file identity before deriving
Rspress routes, so `foo.md` and `foo/index.md` are resolved independently even
when the generated site maps both to the same route. Rspress route collisions
should still be avoided in a publishable vault.

The plugin rewrites wikilinks during the Rspress remark pipeline. All features are opt-in via configuration.

## Install

```bash
# Bun (recommended)
bun add rspress-plugin-obsidian-wikilink

# npm
npm install rspress-plugin-obsidian-wikilink

# pnpm
pnpm add rspress-plugin-obsidian-wikilink

# yarn
yarn add rspress-plugin-obsidian-wikilink
```

Peer requirements:

- `@rspress/core`
- `typescript`

Runtime support:

- Bun `>=1.3.14` is the recommended package manager and development runtime.
- Node.js `>=22.14.0` remains supported for published plugin consumers.

The repository scripts use Bun, while the compiled plugin uses standard Node.js
APIs and remains usable from Rspress installations running on Node.js.

## Obsidian autosync

The repository includes a guarded, one-way vault mirror for local preview. Obsidian
remains the source of truth; the generated directory is disposable Rspress input.

Terminal 1 — sync the vault:

```bash
bun run obsidian:sync -- \
  --source /path/to/your/vault \
  --target .obsidian-rspress-docs \
  --watch
```

Terminal 2 — run Rspress against the generated directory:

```bash
OBSIDIAN_RSPRESS_ROOT=.obsidian-rspress-docs bun run docs:dev
```

The sync copies visible vault files and assets, debounces save bursts, removes
files deleted from the vault, and writes a manifest marker before allowing
subsequent updates. It refuses to use a non-empty target without that marker.
Hidden directories, `.obsidian`, `node_modules`, build output, and cache
directories are excluded automatically. This is intentionally one-way; it never
modifies the vault.

For a one-time mirror, omit `--watch`. Use a dedicated generated target and keep
it out of version control.

## Usage

```ts
import path from "node:path";
import { defineConfig } from "@rspress/core";
import { pluginObsidianWikiLink } from "rspress-plugin-obsidian-wikilink";

export default defineConfig({
  root: path.join(__dirname, "docs"),
  plugins: [pluginObsidianWikiLink({
    onBrokenLink: "error",              // "error" | "warn" (default: "error")
    onAmbiguousLink: "error",           // "error" | "warn" (default: "error")
    onDataviewError: "error",           // "error" | "warn" (default: "error")
    enableFuzzyMatching: false,         // shortest-suffix fallback (default: false)
    enableCaseInsensitiveLookup: true,  // case-insensitive path lookup (default: true, matches Obsidian)
    enableMarkdownLinks: true,          // [x](Page.md) resolved like wikilinks (default: true)
    enableDataview: false,              // static Dataview queries (default: false)
    enableDailyNotes: false,            // date expansion/navigation (default: false)
    dailyNotes: {
      folder: "",
      dateFormat: "YYYY-MM-DD",
      navigation: true,
    },
    enableTagLinking: false,            // #tag → /tags/tag (default: false)
    enableCallouts: false,              // > [!note] → styled divs (default: false)
    enableBacklinks: false,             // append backlinks panel (default: false)
    enableTransclusion: false,          // ![[Page]] → inline content (default: false)
    enableMediaEmbeds: false,           // ![[img.png]] → <img> (default: false)
    enableTagPages: false,              // generate /tags/{name} pages (default: false)
    enableDefaultStyles: false,         // inject bundled CSS (default: false)
  })],
});
```

### `onBrokenLink`

- `"error"` — fail the build on missing page or heading
- `"warn"` — emit a warning and leave the original wikilink text in place

### `onAmbiguousLink`

- `"error"` — fail the build when a basename matches multiple pages
- `"warn"` — emit a warning and leave the original wikilink text in place

### `enableFuzzyMatching`

- `false` — only exact path, basename, title, and alias lookups
- `true` — enables case-insensitive and shortest-suffix fallback matching

### `enableCaseInsensitiveLookup`

- `true` — fall back to case-insensitive matching when exact case fails (default; matches Obsidian, which resolves links to existing files case-insensitively)
- `false` — strict case-sensitive path/basename lookups

### `enableMarkdownLinks`

- `true` — resolve standard markdown links whose destination is a vault page — `[label](Page.md)`, `[label](./relative.md)`, `[label](Page.md#Heading)` — using the same resolution ladder as wikilinks (default; Obsidian accepts both forms)
- `false` — markdown links are left for Rspress's own handling

Only `.md` / `.mdx` destinations are considered. External URLs, pure `#anchors`, extensionless routes, and unresolvable destinations are left untouched.

**Dead-link gate.** Rspress resolves `[](x.md)` relative to the current page and fails the build on misses — before plugin remark plugins can resolve vault-style basename links. When this option is on, the plugin therefore defaults `markdown.link.checkDeadLinks` to `false` (an explicit setting in your Rspress config wins) and takes over the diagnostic itself: unresolvable `.md` destinations are reported through `onBrokenLink`, so genuinely broken links still fail the build by default.

The embed form `![alt](note.md)` transcludes the page exactly like `![[note]]` when `enableTransclusion` is on, and renders as a styled link otherwise.

### `onDataviewError`

- `"error"` — fail the build when a static Dataview query is invalid or when a
  `dataviewjs` block is encountered.
- `"warn"` — keep the original query block and emit a build warning.

### `enableDataview`

- `false` — leave Dataview query blocks unchanged (default).
- `true` — evaluate static `dataview` blocks and inline expressions during the
  build.

Supported query types are `TABLE`, `LIST`, `TASK`, and `CALENDAR`. Supported
commands are `FROM`, `WHERE`, `SORT`, `GROUP BY`, `FLATTEN`, and `LIMIT`.
Metadata comes from YAML frontmatter, `Key:: value` inline fields, task fields,
tags, links, and implicit `file.*` fields.

Common scalar functions include `date`, `length`, `contains`, `startswith`,
`endswith`, `lower`, `upper`, `round`, `floor`, `ceil`, `regexmatch`, `replace`,
`split`, `join`, `typeof`, `default`, `choice`, `sum`, `average`, `min`, and
`max`. `CALENDAR` is rendered as a static date-linked list; it is not an
interactive Obsidian calendar widget.

Example:

````markdown
```dataview
TABLE status, priority, file.link AS note
FROM "projects"
WHERE status = "open"
SORT priority DESC
LIMIT 10
```
````

DataviewJS is evaluated by a restricted interpreter, not JavaScript `eval`.
Supported APIs are `dv.pages`, `dv.current`, `dv.page`, `dv.array`, `dv.date`,
`dv.table`, `dv.list`, `dv.taskList`, `dv.paragraph`, and `dv.header`, plus
restricted collection methods such as `where`, `filter`, `map`, `sort`, `limit`,
`slice`, `join`, and `flat`.

Host access is rejected: `process`, `Bun`, `Deno`, `fetch`, filesystem APIs,
dynamic imports, constructors, prototypes, timers, and arbitrary JavaScript
evaluation are unavailable. Unsupported syntax reports through
`onDataviewError`.

### `enableDailyNotes`

- `false` — leave Daily Note templates and navigation unchanged (default).
- `true` — recognize date-formatted daily note paths, expand date placeholders,
  expose `file.day` to static Dataview queries, and render navigation.

Configuration:

```ts
pluginObsidianWikiLink({
  enableDailyNotes: true,
  dailyNotes: {
    folder: "Daily",
    dateFormat: "YYYY-MM-DD",
    navigation: true,
  },
});
```

Supported template forms include `{{date}}`, `{{date:FORMAT}}`, and offsets such
as `{{date+1d}}`, `{{date-1w}}`, `{{date+1m}}`, and `{{date-1y}}`. This is static
publishing support; it does not create missing notes or implement Obsidian's
interactive Daily Notes command.

### `enableTagLinking`

- `false` — tags are left as-is (default)
- `true` — converts `#tag` to `[#tag](/tags/tag)` (skips code blocks and URL fragments)

### `enableCallouts`

- `false` — callouts are left as blockquotes (default)
- `true` — transforms Obsidian callouts to styled HTML divs or `<details>` elements

Supported base types: `note`, `tip`, `warning`, `danger`, `info`, `success`, `question`, `bug`, `example`, `quote`

Supported aliases: `abstract`/`summary`/`tldr`, `check`/`done`, `help`/`faq`, `caution`/`attention`, `failure`/`fail`/`missing`

> [!IMPORTANT]
> **Rspress built-in alert conflict — resolved automatically.** Rspress
> registers its own GitHub-style alert transform *before* plugin remark
> plugins run, so `> [!note]`, `[!tip]`, `[!warning]`, `[!caution]`,
> `[!danger]`, `[!info]`, and `[!details]` blockquotes arrive already
> converted — with Obsidian's fold suffix (`[!note]-`) leaked into the content
> and the first paragraph of multi-paragraph alerts dropped. When
> `enableCallouts` is on, this plugin detects those converted nodes, verifies
> them against the original source via position information, restores the
> original blockquotes, and renders every Obsidian callout type with full
> semantics. Standard `:::note` directive containers keep Rspress's native
> styling.

**Static callout:**
```markdown
> [!tip] Pro Tip
> This is a callout
```

Output:
```html
<div class="callout callout-tip">
  <div class="callout-title">Pro Tip</div>
  <div class="callout-content">This is a callout</div>
</div>
```

**Foldable callouts:**
```markdown
> [!note]- Collapsed by default
> Hidden until expanded.

> [!note]+ Expanded by default
> Visible immediately.
```

Output uses native `<details>`/`<summary>` — no JavaScript required.

### `enableBacklinks`

- `false` — no backlinks (default)
- `true` — appends a `<div class="obsidian-backlinks">` panel listing all pages that link to the current page

### `enableTransclusion`

- `false` — `![[Page]]` is treated as a regular embed anchor (default)
- `true` — inlines the target file's content at the embed location

Supports section and block scoping:

| Syntax | Behavior |
|--------|----------|
| `![[Page]]` | Inlines full page content (frontmatter stripped) |
| `![[Page#Heading]]` | Inlines only the content under that heading (ATX and setext) |
| `![[Page#^block]]` | Inlines only the paragraph annotated with `^block` |
| `![alt](Page.md)` | Markdown embed form — behaves exactly like `![[Page]]` |

A standalone `^block-id` separated from its block by a blank line still
references the block above it. When a section cannot be located in the target
file, the embed renders as a link to the page (with a build warning) instead
of inlining the entire page — matching Obsidian's unresolved-embed behaviour.

Any wikilinks inside the transcluded content are resolved automatically.

Output:
```html
<div class="obsidian-transclusion" data-src="/page">
  ...inlined content...
</div>
```

### `enableMediaEmbeds`

- `false` — `![[file]]` is treated as a regular embed anchor (default)
- `true` — renders media files as native HTML elements

| Extension | Output |
|-----------|--------|
| `png`, `jpg`, `jpeg`, `gif`, `svg`, `webp`, `avif` | `<img>` |
| `mp3`, `wav`, `ogg`, `m4a`, `flac` | `<audio controls>` |
| `mp4`, `webm`, `mov`, `mkv` | `<video controls>` |
| `pdf` | `<iframe>` |

Size parameter: `![[image.png|300x200]]` → `<img width="300" height="200" />`

Media paths are resolved relative to the current file, then the docs root, then fall back to a root-relative URL.

### `enableTagPages`

- `false` — no tag pages generated (default)
- `true` — auto-generates a `/tags/{name}` index page for every unique tag found in frontmatter `tags:` fields

Each generated page lists all pages carrying that tag with links. Requires `enableTagLinking: true` for the inline `#tag` links to point to these pages.

```yaml
---
tags:
  - tutorial
  - obsidian
---
```

Generates `/tags/tutorial` and `/tags/obsidian`.

### `enableDefaultStyles`

- `false` — no styles injected (default)
- `true` — automatically injects the bundled stylesheet via Rspress `globalStyles`

The stylesheet covers all CSS classes emitted by this plugin:
- `.callout`, `.callout-{type}`, `.callout-title`, `.callout-content`
- `details.callout > summary.callout-title` (foldable)
- `.obsidian-backlinks`
- `.obsidian-transclusion`
- `.obsidian-embed`

You can also import the stylesheet manually:

```ts
// rspress.config.ts
import { pluginObsidianWikiLink } from "rspress-plugin-obsidian-wikilink";
import stylesPath from "rspress-plugin-obsidian-wikilink/styles.css?url";

export default defineConfig({
  globalStyles: stylesPath,
  plugins: [pluginObsidianWikiLink()],
});
```

Or in a CSS file:
```css
@import "rspress-plugin-obsidian-wikilink/styles.css";
```

## Obsidian Comments

`%% ... %%` comments are automatically stripped from the output — no option needed.

```markdown
This text is visible. %% This comment is private. %% Back to visible.
```

Multi-line block comments are also stripped:
```markdown
%%
This entire paragraph is a private draft note.
%%
```

## Text Highlighting

`==text==` is transformed to `<mark>` tags for highlighted text.

```markdown
This is ==highlighted text== in a sentence.
```

Output:
```html
This is <mark>highlighted text</mark> in a sentence.
```

## Footnotes

Footnote references `[^1]` are converted to superscript links, with definitions rendered at the end of the page.

```markdown
This is a statement[^1] with a footnote.

[^1]: This is the footnote definition.
```

Output:
```html
This is a statement<sup class="footnote-ref" id="fnref-1"><a href="#fn-1" title="This is the footnote definition.">1</a></sup> with a footnote.

<hr />
<ol class="footnotes">
<li id="fn-1">This is the footnote definition. <a href="#fnref-1">↩</a></li>
</ol>
```

Inline footnotes are also supported:
```markdown
Inline footnote^[This is inline] works differently.
```

## Resolution rules

Resolution order for `[[target]]` (and for `[label](target.md)` markdown links):

1. Explicitly relative path (`./` or `../`) from the current note
2. Exact vault path match
3. Unique basename match
4. Unique frontmatter `title` match
5. Unique frontmatter `aliases` match
6. Case-insensitive fallback (default; disable with `enableCaseInsensitiveLookup: false`)
7. Fuzzy matching (when `enableFuzzyMatching` is enabled)
8. Rejected as broken or ambiguous

Examples:
| Wikilink | Resolves via |
|----------|-------------|
| `[[guide/getting-started]]` | Exact path |
| `[[../shared/Concept]]` | Path relative to the current note |
| `[[getting-started]]` | Basename (unique) |
| `[[Onboarding Guide]]` | Frontmatter `title` |
| `[[Start Here]]` | Frontmatter `aliases` |
| `[[#Install]]` | Current page heading |
| `[[## Install]]` | Vault-wide heading search (unique result) |
| `[[^^install-block]]` | Vault-wide block search (unique result) |
| `[[guide/getting-started#^install-block]]` | Block reference |
| `![[guide/getting-started#Install]]` | Section transclusion |

Heading anchors use Rspress-compatible GitHub slugging: spaces become hyphens,
Unicode letters are preserved, duplicate headings receive `-1`, `-2`, and so on,
and explicit `{#custom-anchor}` IDs take precedence. Explicit relative paths do
not fall back to basename or metadata lookup when their target is missing.
Supported heading formats: ATX, ATX with closing `#`, up to 3 leading spaces, setext (`===` / `---`), explicit IDs `{#custom-anchor}`

Supported block ID formats: standalone line (`^block-id`) and inline at end of paragraph (`text content ^block-id`)

## Frontmatter support

The plugin indexes and supports the following Obsidian frontmatter fields:

### `title`

Sets the page title for link resolution. Used for `[[Title]]` lookups.

```yaml
---
title: My Custom Title
---
```

### `aliases`

Alternative names for link resolution. Supports list and inline array formats.

```yaml
---
aliases:
  - First Alias
  - Second Alias
---
# or inline
aliases: [First Alias, Second Alias]
```

### `tags`

Tags for categorization and tag page generation.

```yaml
---
tags:
  - tutorial
  - obsidian
---
```

### `cssclasses`

Custom CSS classes to apply to the page (available in `ContentPage.cssclasses`).

```yaml
---
cssclasses:
  - custom-layout
  - dark-theme
---
```

### `excerpt`

Page excerpt/description for SEO (available in `ContentPage.excerpt`).

```yaml
---
excerpt: A brief description of this page
---
```

## Development

```bash
# Install dependencies (Bun recommended)
bun install

# Type checking
bun run typecheck

# Linting (Biome)
bun run lint          # check only
bun run lint:fix      # auto-fix
bun run format:check  # formatting check (no writes)

# Run tests
bun test
bun run test:coverage

# Build (cross-platform via scripts/build.ts)
bun run build

# Build docs
bun run docs:build
```

See [CONTRIBUTING.md](./.github/CONTRIBUTING.md) for the full workflow, commit conventions, and feature guidelines.

## Package exports

Functions:

- `pluginObsidianWikiLink`
- `buildContentIndex`
- `getCachedContentIndex`
- `buildBacklinksIndex`
- `getCachedBacklinksIndex`
- `renderBacklinksHtml`
- `generateTagPages`
- `encodeTagPathSegment`
- `parseWikiLink`
- `findWikilinkMatches`
- `resolveWikiLink`

Stylesheets:

- `rspress-plugin-obsidian-wikilink/styles.css`

Types:

- `RspressPluginObsidianWikiLinkOptions`
- `NormalizedPluginOptions`
- `ParsedWikiLink`
- `ContentPage`
- `ContentIndex`
- `ResolvedWikiLink`
- `ResolveContext`
- `BacklinkRef`
- `AdditionalPage`
- And more — see `src/types.ts`

## License
MIT License — see [LICENSE](LICENSE) file for details.

## Status

v0.1.1 — Static Obsidian-flavored Markdown support for Rspress; see the compatibility scope above for deliberate boundaries.
