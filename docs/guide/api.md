---
description: Complete API reference for rspress-plugin-obsidian-wikilink. Covers pluginObsidianWikiLink, buildContentIndex, parseWikiLink, resolveWikiLink, encodeTagPathSegment, generateTagPages, backlinks, and all TypeScript types.
---

# API Reference

This document covers the public API exported from `rspress-plugin-obsidian-wikilink`.

## Plugin Function

### `pluginObsidianWikiLink(options?)`

Creates an Rspress plugin that rewrites wikilinks during the remark pipeline.

```ts
import { pluginObsidianWikiLink } from "rspress-plugin-obsidian-wikilink";
import { defineConfig } from "@rspress/core";

export default defineConfig({
  plugins: [
    pluginObsidianWikiLink({
      onBrokenLink: "error",
      enableCallouts: true,
      enableTagLinking: true,
      enableTagPages: true,
      enableDefaultStyles: true,
    }),
  ],
});
```

#### Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `onBrokenLink` | `"error" \| "warn"` | `"error"` | How to handle missing link targets |
| `onAmbiguousLink` | `"error" \| "warn"` | `"error"` | How to handle ambiguous links |
| `enableFuzzyMatching` | `boolean` | `false` | Enable shortest-suffix path fallback |
| `enableCaseInsensitiveLookup` | `boolean` | `true` | Case-insensitive path resolution (matches Obsidian; set `false` for strict matching) |
| `enableMarkdownLinks` | `boolean` | `true` | Resolve `[label](Page.md)` markdown links and `![alt](note.md)` embeds against the vault |
| `enableTagLinking` | `boolean` | `false` | Convert `#tag` to `/tags/tag` links |
| `enableTagPages` | `boolean` | `false` | Generate `/tags/{name}` index pages |
| `enableCallouts` | `boolean` | `false` | Transform `> [!note]` callouts |
| `enableBacklinks` | `boolean` | `false` | Append backlinks panel to each page |
| `enableTransclusion` | `boolean` | `false` | Inline `![[Page]]` content |
| `enableMediaEmbeds` | `boolean` | `false` | Render `![[img.png]]` as `<img>` |
| `enableDefaultStyles` | `boolean` | `false` | Inject bundled CSS stylesheet |

## Content Index

### `buildContentIndex(rootDir: string): Promise<ContentIndex>`

Scans all `.md` and `.mdx` files under `rootDir` and builds a lookup index. Runs on every call.

```ts
import { buildContentIndex } from "rspress-plugin-obsidian-wikilink";

const index = await buildContentIndex("/path/to/docs");
console.log(index.pages.length);
console.log(index.byTag.get("tutorial"));
```

### `getCachedContentIndex(rootDir: string): Promise<ContentIndex>`

Returns a cached index when file mtimes and sizes are unchanged since the last call. Preferred over `buildContentIndex` in hot paths.

```ts
import { getCachedContentIndex } from "rspress-plugin-obsidian-wikilink";

const index = await getCachedContentIndex("/path/to/docs");
```

## Wikilink Parsing

### `findWikilinkMatches(content: string): WikilinkMatch[]`

Finds all wikilinks (including embed syntax) in a markdown string.

```ts
import { findWikilinkMatches } from "rspress-plugin-obsidian-wikilink";

const matches = findWikilinkMatches("Check [[Page1]] and ![[Page2|Embed]].");
// matches[0] → { fullMatch: "[[Page1]]", inner: "Page1", start: 6, end: 14 }
// matches[1] → { fullMatch: "![[Page2|Embed]]", inner: "Page2|Embed", ... }
```

### `parseWikiLink(inner: string, raw: string): ParsedWikiLink`

Parses the inner content of a wikilink into its components.

```ts
import { parseWikiLink } from "rspress-plugin-obsidian-wikilink";

const parsed = parseWikiLink(
  "guide/getting-started#Install|Install guide",
  "[[guide/getting-started#Install|Install guide]]",
);
// {
//   raw: "[[guide/getting-started#Install|Install guide]]",
//   target: "guide/getting-started",
//   alias: "Install guide",
//   isEmbed: false,
//   subpath: { kind: "heading", value: "Install" },
//   isCurrentPageReference: false
// }
```

## Wikilink Resolution

### `resolveWikiLink(parsed: ParsedWikiLink, context: ResolveContext): ResolvedWikiLink`

Resolves a parsed wikilink to its final href using the content index.

```ts
import {
  buildContentIndex,
  findWikilinkMatches,
  parseWikiLink,
  resolveWikiLink,
} from "rspress-plugin-obsidian-wikilink";

const index = await buildContentIndex("/path/to/docs");
const currentPage = index.byPathKey.get("guide/intro")!;

const [match] = findWikilinkMatches("See [[getting-started]].");
const parsed = parseWikiLink(match.inner, match.fullMatch);
const resolved = resolveWikiLink(parsed, { currentPage, index });

if (resolved.status === "ok") {
  console.log(resolved.href);  // "/guide/getting-started"
  console.log(resolved.label); // "getting started"
}
```

## Backlinks

### `buildBacklinksIndex(index: ContentIndex): Promise<Map<string, BacklinkRef[]>>`

Builds the backlinks map from the content index. Backlinks are now built automatically during content indexing (via `buildContentIndex`), so you seldom need this function directly. Use `getCachedBacklinksIndex` instead.

### `getCachedBacklinksIndex(index: ContentIndex): Promise<Map<string, BacklinkRef[]>>`

Returns the backlinks map for the given content index. When the index was built via `buildContentIndex` or `getCachedContentIndex`, backlinks are already populated — this is a simple property access with no I/O. A fallback cache handles indexes constructed manually.

```ts
import { getCachedContentIndex, getCachedBacklinksIndex } from "rspress-plugin-obsidian-wikilink";

const index = await getCachedContentIndex("/path/to/docs");
const backlinks = await getCachedBacklinksIndex(index);
const refs = backlinks.get("/guide/getting-started") ?? [];
// refs: [{ routePath: "/guide/intro", title: "Introduction" }]
```

### `renderBacklinksHtml(refs: BacklinkRef[]): string`

Renders a list of backlink references as a `<div class="obsidian-backlinks">` HTML string. Returns an empty string when `refs` is empty.

## Tag Pages

### `generateTagPages(index: ContentIndex): AdditionalPage[]`

Generates one page entry per unique tag found across all pages. Each entry has the shape `{ routePath, content }` compatible with the Rspress `addPages` hook.

```ts
import { buildContentIndex, generateTagPages } from "rspress-plugin-obsidian-wikilink";

const index = await buildContentIndex("/path/to/docs");
const pages = generateTagPages(index);
// [
//   { routePath: "/tags/tutorial", content: "---\ntitle: \"#tutorial\"\n---\n..." },
//   { routePath: "/tags/obsidian", content: "..." },
// ]
```

### `encodeTagPathSegment(tag: string): string`

Encodes a tag name for safe use in URL path segments. Preserves Unicode letters, hyphens, underscores, and nested-tag separators (`/`). Encodes whitespace, HTML-reserved, and URL-reserved characters.

```ts
import { encodeTagPathSegment } from "rspress-plugin-obsidian-wikilink";

encodeTagPathSegment("hello world");  // "hello%20world"
encodeTagPathSegment("parent/child"); // "parent/child"
encodeTagPathSegment("中文");          // "中文"
```

## Types

### `RspressPluginObsidianWikiLinkOptions`

```ts
interface RspressPluginObsidianWikiLinkOptions {
  onBrokenLink?: "error" | "warn";
  onAmbiguousLink?: "error" | "warn";
  enableFuzzyMatching?: boolean;
  enableCaseInsensitiveLookup?: boolean;
  enableTagLinking?: boolean;
  enableTagPages?: boolean;
  enableCallouts?: boolean;
  enableBacklinks?: boolean;
  enableTransclusion?: boolean;
  enableMediaEmbeds?: boolean;
  enableDefaultStyles?: boolean;
}
```

### `ParsedWikiLink`

```ts
interface ParsedWikiLink {
  raw: string;       // Original wikilink text e.g. "[[Page#Heading|Alias]]"
  target: string;    // Target page path e.g. "Page"
  alias?: string;    // Custom display text e.g. "Alias"
  isEmbed: boolean;  // True when the wikilink starts with ![[
  subpath?: {
    kind: "heading" | "block";
    value: string;   // Heading text or block ID (without ^)
  };
  isCurrentPageReference: boolean; // True for [[#Heading]] (no target)
}
```

### `WikilinkMatch`

```ts
interface WikilinkMatch {
  fullMatch: string; // The full wikilink e.g. "[[Page]]"
  inner: string;     // Content between [[ and ]] e.g. "Page"
  start: number;     // Start index in source string
  end: number;       // End index in source string
}
```

### `ContentPage`

```ts
interface ContentPage {
  absolutePath: string;        // Absolute file path on disk
  relativePath: string;        // Relative to docs root e.g. "guide/intro.md"
  routePath: string;           // Rspress route e.g. "/guide/intro"
  pathKey: string;             // Normalised path key e.g. "guide/intro"
  baseName: string;            // Filename without extension e.g. "intro"
  title?: string;              // Frontmatter title
  aliases: string[];           // Frontmatter aliases
  tags: string[];              // Frontmatter tags
  cssclasses: string[];        // Frontmatter cssclasses
  excerpt?: string;            // Frontmatter excerpt
  publish: boolean;            // Frontmatter publish (default: true)
  headings: HeadingEntry[];    // Parsed headings from the file
  wikilinkTargets: string[];   // Pre-extracted, deduplicated wikilink targets (used for backlinks)
  headingBySlug: Map<string, HeadingEntry>;   // Slug → heading, O(1) resolution
  headingByText: Map<string, HeadingEntry>;   // Normalized text → heading, O(1) resolution
  blocks: BlockEntry[];        // Parsed block IDs from the file
}
```

### `ContentIndex`

```ts
interface ContentIndex {
  rootDir: string;
  pages: ContentPage[];
  byAbsolutePath: Map<string, ContentPage>;
  byPathKey: Map<string, ContentPage>;
  byBaseName: Map<string, ContentPage[]>;
  byTitle: Map<string, ContentPage[]>;
  byAlias: Map<string, ContentPage[]>;
  byTag: Map<string, ContentPage[]>;
  byPathKeyCI: Map<string, ContentPage[]>;     // Case-insensitive pathKey lookup
  byBaseNameCI: Map<string, ContentPage[]>;    // Case-insensitive basename lookup
  rawContentByPath: Map<string, string>;       // Raw markdown content, used by transclusion
  backlinks: Map<string, BacklinkRef[]>;        // Pre-built during indexing
}
```

### `HeadingEntry`

```ts
interface HeadingEntry {
  rawText: string;          // Heading text (markdown formatting stripped)
  slug: string;             // GitHub-style slug
  explicitId?: string;      // Custom anchor from {#custom-anchor}
  preview?: string;         // Plain-text content snippet after heading (for tooltips)
}
```

### `BlockEntry`

```ts
interface BlockEntry {
  id: string; // Block ID without the leading ^
}
```

### `ResolvedWikiLink`

```ts
interface ResolvedWikiLink {
  status: "ok" | "broken-page" | "broken-anchor" | "ambiguous-page";
  href?: string;          // Final URL e.g. "/guide/intro#install"
  label?: string;         // Display text
  targetPage?: ContentPage;
  message?: string;       // Diagnostic message on non-ok status
  description?: string;   // Heading content preview for tooltips
}
```

### `ResolveContext`

```ts
interface ResolveContext {
  currentPage: ContentPage;
  index: ContentIndex;
  options?: {
    enableFuzzyMatching?: boolean;
    enableCaseInsensitiveLookup?: boolean;
  };
}
```

### `BacklinkRef`

```ts
interface BacklinkRef {
  routePath: string; // Route of the linking page
  title: string;     // Title or basename of the linking page
}
```

### `DiagnosticMode`

```ts
type DiagnosticMode = "error" | "warn";
```

### `WikiSubpath`

```ts
interface WikiSubpath {
  kind: "heading" | "block";
  value: string; // Heading text or block ID (without ^)
}
```

### `AdditionalPage`

```ts
interface AdditionalPage {
  routePath: string; // e.g. "/tags/tutorial"
  content: string;   // Raw markdown content for the generated page
}
```

### `RemarkWikiLinkPluginOptions`

```ts
interface RemarkWikiLinkPluginOptions {
  getDocsRoot: () => string;
  options: NormalizedPluginOptions;
}
```
