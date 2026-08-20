---
description: Complete configuration reference for rspress-plugin-obsidian-wikilink. Covers all options, callout types and aliases, transclusion, media embeds, highlights, footnotes, comments, link resolution rules, and frontmatter fields.
---

# Advanced

## All Configuration Options

```ts
pluginObsidianWikiLink({
  // Link diagnostics
  onBrokenLink: "error",              // "error" | "warn" (default: "error")
  onAmbiguousLink: "error",           // "error" | "warn" (default: "error")

  // Resolution
  enableFuzzyMatching: false,         // shortest-suffix path fallback
  enableCaseInsensitiveLookup: true,  // case-insensitive path lookup (default)
  enableMarkdownLinks: true,          // [x](Page.md) resolved like wikilinks

  // Content features
  enableTagLinking: false,            // #tag → /tags/tag
  enableTagPages: false,              // generate /tags/{name} index pages
  enableCallouts: false,              // > [!note] → styled HTML
  enableBacklinks: false,             // append backlinks panel
  enableTransclusion: false,          // ![[Page]] → inline content
  enableMediaEmbeds: false,           // ![[img.png]] → <img>

  // Styling
  enableDefaultStyles: false,         // inject bundled CSS
});
```

### `onBrokenLink`

Controls how the plugin handles links to non-existent pages or headings:

- `"error"` (default) — fail the build when a link target is missing
- `"warn"` — emit a warning but leave the original wikilink text in place

### `onAmbiguousLink`

Controls how the plugin handles ambiguous links (multiple pages share the same basename):

- `"error"` (default) — fail the build when multiple pages match
- `"warn"` — emit a warning but leave the original wikilink text in place

### `enableFuzzyMatching`

- `false` (default) — only exact path, basename, title, and alias lookups
- `true` — enables case-insensitive and shortest-suffix fallback matching

### `enableCaseInsensitiveLookup`

- `true` (default) — falls back to case-insensitive matching when exact case fails; matches Obsidian, which resolves links to existing files case-insensitively
- `false` — strict case-sensitive path/basename lookups

### `enableMarkdownLinks`

- `true` (default) — standard markdown links to vault pages (`[label](Page.md)`, including `#anchors` and `./relative.md` forms) resolve through the same ladder as wikilinks, matching Obsidian's acceptance of both link forms
- `false` — markdown links are left to Rspress's own handling

Only `.md` / `.mdx` destinations are considered; external URLs, pure `#anchors`, and extensionless routes are untouched. The embed form `![alt](note.md)` transcludes like `![[note]]` when `enableTransclusion` is on and renders as a styled link otherwise.

**Dead-link gate.** Rspress resolves `[](x.md)` relative to the current page and
fails the build on misses — before plugin remark plugins can resolve
vault-style basename links. When this option is on, the plugin therefore
defaults `markdown.link.checkDeadLinks` to `false` (an explicit setting in
your Rspress config wins) and takes over the diagnostic itself: unresolvable
`.md` destinations are reported through `onBrokenLink`, so genuinely broken
links still fail the build by default.

### `enableTagLinking`

- `false` (default) — tags are left as-is in the output
- `true` — converts `#tag` to `[#tag](/tags/tag)`; skips code blocks and URL fragments

Tag names must start with a letter or underscore (pure-numeric strings like `#123` are never matched). Nested tags (`#parent/child`) and Unicode letters (Latin extended, CJK) are supported.

### `enableTagPages`

- `false` (default) — no tag pages generated
- `true` — auto-generates a `/tags/{name}` index page for every unique tag found in frontmatter `tags:` fields

Each generated page lists all pages with that tag:

```yaml
---
tags:
  - tutorial
  - obsidian
---
```

Produces `/tags/tutorial` and `/tags/obsidian`, each listing all pages tagged with that value.

> **Note**: combine with `enableTagLinking: true` so that inline `#tag` links point to the generated pages.

### `enableCallouts`

- `false` (default) — Obsidian callouts remain as plain blockquotes
- `true` — transforms callouts to styled HTML `<div>` (static) or `<details>` (foldable)

**Supported base types:**

| Type | Visual treatment |
|------|------------------|
| `note` | Blue accent |
| `tip` | Teal accent |
| `info` | Cyan accent |
| `todo` | Green accent |
| `success` | Green accent |
| `question` | Lime accent |
| `warning` | Orange accent |
| `danger` | Red accent |
| `bug` | Pink accent |
| `example` | Purple accent |
| `quote` | Neutral accent |
| `abstract` | Cyan accent |
| `caution` | Orange accent |
| `failure` | Red accent |

**Supported aliases** (map to canonical type above):

| Aliases | Canonical |
|---------|-----------|
| `summary`, `tldr` | `abstract` |
| `check`, `done` | `success` |
| `help`, `faq` | `question` |
| `hint`, `important` | `tip` |
| `attention` | `caution` |
| `failure`, `fail`, `missing` | `failure` |
| `error` | `danger` |
| `cite` | `quote` |

**Static callout:**
```markdown
> [!failure] Watch out
> This will be transformed.
```

Output:
```html
<div class="callout callout-failure">
  <div class="callout-title">Watch out</div>
  <div class="callout-content">This will be transformed.</div>
</div>
```

**Foldable callouts** use native `<details>`/`<summary>` — no JavaScript required:

```markdown
> [!success]- Collapsed by default
> Hidden until the user clicks.

> [!example]+ Expanded by default
> Visible immediately, but collapsible.
```

**Callout titles are inline markdown.** Bold, italics, code, and wikilinks
render inside the title, matching Obsidian:

```markdown
> [!question] See [[guide/getting-started|Getting Started]] for **setup**
> Body text
```

**Rspress built-in alert conflict — resolved automatically.** Rspress
registers its own GitHub-style alert transform before plugin remark plugins
run, so `> [!note]`, `[!tip]`, `[!warning]`, `[!caution]`, `[!danger]`,
`[!info]`, and `[!details]` blockquotes arrive already converted — with
Obsidian's fold suffix (`[!note]-`) leaked into the content and the first
paragraph of multi-paragraph alerts dropped. When `enableCallouts` is on, the
plugin detects those converted nodes, verifies them against the original
source via position information, restores the original blockquotes, and
renders every Obsidian callout type with full semantics. Standard `:::note`
directive containers keep Rspress's native styling.

### `enableBacklinks`

- `false` (default) — no backlinks appended
- `true` — scans all pages for incoming links and appends a `<div class="obsidian-backlinks">` panel at the bottom of each page

The backlinks index is built during content indexing and stored on the `ContentIndex` object. No extra file reads or regex scans are needed at build time.

### `enableTransclusion`

- `false` (default) — `![[Page]]` is rewritten to an embed anchor
- `true` — inlines the referenced file's content at the embed location

| Syntax | Result |
|--------|--------|
| `![[Page]]` | Full file content (frontmatter stripped) |
| `![[Page#Heading]]` | Only the section under that heading |
| `![[Page#^block]]` | Only the paragraph annotated with `^block` |
| `![alt](Page.md)` | Markdown embed form — same as `![[Page]]` |

A standalone `^block-id` separated from its block by a blank line still
references the block above it. When a section cannot be located in the target
file, the embed renders as a link to the page (with a build warning) instead
of inlining the entire page — matching Obsidian's unresolved-embed behaviour.

Supports ATX and setext headings in the target file. Any `[[wikilinks]]` found inside transcluded content are resolved automatically.

Output wraps content in:
```html
<div class="obsidian-transclusion" data-src="/page">
  ...inlined content...
</div>
```

### `enableMediaEmbeds`

- `false` (default) — `![[file]]` is rewritten to an embed anchor
- `true` — renders media files as native HTML elements

| Extension | Output element |
|-----------|---------------|
| `png`, `jpg`, `jpeg`, `gif`, `svg`, `webp`, `avif` | `<img loading="lazy">` |
| `mp3`, `wav`, `ogg`, `m4a`, `flac` | `<audio controls>` |
| `mp4`, `webm`, `mov`, `mkv` | `<video controls>` |
| `pdf` | `<iframe>` |

Size parameter: `![[image.png|300x200]]` → `width="300" height="200"`. Width-only: `![[image.png|300]]` → `width="300"`.

Media paths are resolved in order:
1. Relative to the current file's directory
2. Relative to the docs root
3. Root-relative fallback (`/filename`)

### `enableDefaultStyles`

- `false` (default) — no styles injected
- `true` — automatically injects the bundled stylesheet via Rspress `globalStyles`

Covers all CSS classes emitted by this plugin: `.callout-*`, `.obsidian-backlinks`, `.obsidian-transclusion`, `.obsidian-embed`. Uses Rspress CSS variables (`--rp-c-brand`, `--rp-c-bg-soft`, etc.) for automatic dark/light mode compatibility.

You can also import the stylesheet manually instead:

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

`%% ... %%` comments are stripped automatically — no option required:

```markdown
Visible text. %% Private note — not published. %% More visible text.
```

Multi-line block comments:

```markdown
%%
This entire paragraph is a private draft.
%%
```

> **Limitation**: comments that span multiple paragraphs (opening `%%` in one paragraph, closing `%%` in another) are not stripped.

## Text Highlighting

`==text==` is transformed to `<mark>` tags — no option required:

```markdown
This is ==highlighted text== in a sentence.
```

Output:
```html
This is <mark>highlighted text</mark> in a sentence.
```

## Footnotes

Footnote references `[^1]` are converted to superscript links, with definitions rendered at the end of the page — no option required:

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

## Link Resolution

Resolution order for `[[target]]`:

1. **Explicitly relative path** — `[[../shared/Concept]]`, resolved from the current note
2. **Exact vault path** — `[[guide/getting-started]]`
3. **Unique basename** — `[[getting-started]]` (one page matches)
4. **Frontmatter `title`** — `[[Onboarding Guide]]` (unique match)
5. **Frontmatter `aliases`** — `[[Start Here]]` (unique match)
6. **Case-insensitive** — (default; disable with `enableCaseInsensitiveLookup: false`)
7. **Fuzzy matching** — (when `enableFuzzyMatching` is on) case-insensitive, shortest-suffix
8. **Rejected** — broken or ambiguous

Explicit `./` and `../` paths do not fall back to basename or metadata lookup when
their target is missing.

## Heading Resolution

Supported heading formats in target files:

- Standard ATX: `# Heading`
- ATX with closing: `# Heading ##`
- Up to 3 leading spaces: `   # Heading`
- Setext H1: `Heading\n=======`
- Setext H2: `Heading\n-------`
- Explicit IDs: `## Heading {#custom-anchor}`

Heading anchors use Rspress-compatible GitHub slugging. Unicode letters are
preserved, duplicate headings receive `-1`, `-2`, and explicit IDs take
precedence over generated slugs.

## Block ID Formats

The plugin indexes both block ID formats:

```markdown
Standalone block ID on its own line:

^my-block

Inline block ID appended to a paragraph: ^inline-block
```

Both are reachable via `[[Page#^my-block]]` and `[[Page#^inline-block]]`.

## Frontmatter Fields

The plugin reads these frontmatter fields from each page:

| Field | Purpose | Default |
|-------|---------|---------|
| `title` | Used as a lookup key (`[[My Title]]`) and as the default label | — |
| `aliases` | Additional lookup keys (`[[Alias Name]]`). Also accepts singular `alias` | `[]` |
| `tags` | Indexed in `byTag`; used to generate tag pages when `enableTagPages` is on. Also accepts singular `tag` | `[]` |
| `cssclasses` | Custom CSS classes applied to the page container. Also accepts singular `cssclass` | `[]` |
| `excerpt` | Page excerpt/description for SEO | — |
| `publish` | Set to `false` to exclude the page from indexing | `true` |

### `publish: false` — Draft Pages

The `publish` field controls whether a page is included in the content index:

```yaml
---
title: Work in Progress
tags:
  - draft
publish: false
---
```

When `publish` is `false`:
- The page is excluded from all lookup tables (`byPathKey`, `byBaseName`, `byTitle`, `byAlias`, `byTag`)
- Wikilinks pointing to the page are treated as broken links
- The page does not appear in tag index pages or backlinks panels
- Other pages cannot transclude its content

Accepted values:
- `true` / `yes` / `1` — page is included (default when field is absent)
- `false` / `no` / `0` — page is excluded

YAML strings are case-insensitive: `publish: "False"` and `publish: "No"` both exclude the page.

## Debugging

Use `"warn"` to inspect which links can't be resolved without failing the build:

```ts
pluginObsidianWikiLink({
  onBrokenLink: "warn",
  onAmbiguousLink: "warn",
});
```

## Troubleshooting & FAQ

### My build fails with "Unable to resolve wikilink target"

The plugin's default `onBrokenLink: "error"` stops the build on any unresolvable wikilink. To find which links are broken:

```ts
pluginObsidianWikiLink({
  onBrokenLink: "warn",
  onAmbiguousLink: "warn",
});
```

With `"warn"`, the build continues and each broken link prints a message showing exactly which page and target are problematic. The broken-anchor variant now lists available headings/blocks to help you find the right name.

### My `[[Page]]` wikilink reports as ambiguous

Multiple pages share the same filename (e.g. `docs/guide/getting-started.md` and `docs/tutorial/getting-started.md`). Fix by using a path-qualified link: `[[guide/getting-started]]` instead of `[[getting-started]]`.

### Transcluded content shows "Heading not found" but the heading exists

The heading matching is case-sensitive by default and respects exact text including punctuation. Enable fuzzy fallbacks:

```ts
pluginObsidianWikiLink({
  enableFuzzyMatching: true,
  enableCaseInsensitiveLookup: true,
});
```

Or check the available headings listed in the diagnostic message — you may have a subtle character difference.

### My `![[image.png|300x200]]` renders as a broken embed anchor

The file isn't found on disk. The plugin resolves media paths in this order:
1. Relative to the current markdown file
2. Relative to the docs root
3. As a root-relative URL (fallback, with a warning)

Move the file into your docs directory or update the path.

### Callouts render as plain blockquotes

Callouts require `enableCallouts: true` in the plugin options. All features except wikilinks, comments, highlights, and footnotes are opt-in.

### My `publish: false` page still appears in the build

The `publish` field excludes a page from the **content index** — it won't appear in search, tag pages, or backlinks. It may still be rendered by Rspress if it's in the docs directory. To fully exclude a page, move it outside the docs root or prefix the filename with an underscore (Rspress convention).

### Footnotes render as raw `[^1]` text

Footnote definitions must match the pattern `[^label]: definition text` with a colon after the label. Single-word definitions like `[^a]: Alpha` can be misinterpreted by the remark parser as link definitions. Use multi-word prose: `[^alpha]: Alpha definition here.`

### Memory usage grows when building many documentation sites in one process

The content index cache is bounded to 10 entries with LRU eviction. If you need more simultaneous cached indexes, adjust `MAX_CACHED_INDEXES` in the source.

### I found a bug or have a feature request

Open an issue at [github.com/Jacob-Valor/rspress-plugin-obsidian-wikilink/issues](https://github.com/Jacob-Valor/rspress-plugin-obsidian-wikilink/issues). See the [Contributing Guide](https://github.com/Jacob-Valor/rspress-plugin-obsidian-wikilink/blob/main/.github/CONTRIBUTING.md) for development workflow and commit conventions.

## Changelog

See the [CHANGELOG](https://github.com/Jacob-Valor/rspress-plugin-obsidian-wikilink/blob/main/CHANGELOG.md) for version history and release notes.

## Next Steps

- See the [[api|API Reference]] for programmatic usage
