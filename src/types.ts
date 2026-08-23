/**
 * How diagnostic events are surfaced to the Rspress build.
 * - `"error"` — calls {@link import("vfile").VFile.fail}, failing the build.
 * - `"warn"` — calls {@link import("vfile").VFile.message}, emitting a warning.
 */
export type DiagnosticMode = "error" | "warn";

/**
 * Plugin options accepted by {@link import("./index.ts").pluginObsidianWikiLink}.
 * All fields are optional; the normalized defaults are conservative (most
 * opt-in features disabled).
 */
export interface DailyNotesOptions {
	/** Vault-relative folder containing date-formatted daily notes. */
	folder?: string;
	/** Moment-style date format used in filenames. Default: `YYYY-MM-DD`. */
	dateFormat?: string;
	/** Add previous/current/next links to published daily notes. Default: `true`. */
	navigation?: boolean;
}

export interface RspressPluginObsidianWikiLinkOptions {
	/** How to report unresolvable wikilinks. Default: `"error"`. */
	onBrokenLink?: DiagnosticMode;
	/** How to report wikilinks that match multiple pages. Default: `"error"`. */
	onAmbiguousLink?: DiagnosticMode;
	/**
	 * Enable shortest-suffix fuzzy matching when exact, basename, title,
	 * and alias lookups all fail. Default: `false`.
	 */
	enableFuzzyMatching?: boolean;
	/**
	 * Enable case-insensitive path and basename fallback. Obsidian resolves
	 * links to existing files case-insensitively, so the default is `true`.
	 * Set to `false` for strict case-sensitive matching.
	 */
	enableCaseInsensitiveLookup?: boolean;
	/**
	 * Resolve standard markdown links (`[label](Page.md)`, including
	 * `#anchor` destinations and the `![alt](note.md)` embed form) against
	 * the vault index using the same resolution ladder as wikilinks.
	 * Default: `true`. External URLs, pure anchors, and unresolvable targets
	 * are left untouched.
	 */
	enableMarkdownLinks?: boolean;
	/**
	 * How invalid or unsupported Dataview blocks are reported. Default: `"error"`.
	 */
	onDataviewError?: DiagnosticMode;
	/**
	 * Evaluate static Dataview DQL blocks and inline expressions at build time.
	 * DataviewJS is never executed. Default: `false`.
	 */
	enableDataview?: boolean;
	/**
	 * Enable static Daily Notes date expansion and navigation. Default: `false`.
	 */
	enableDailyNotes?: boolean;
	/** Daily Notes folder, filename format, and navigation settings. */
	dailyNotes?: DailyNotesOptions;
	/**
	 * Rewrite inline `#tag` tokens into links to `/tags/<tag>`. Default: `false`.
	 */
	enableTagLinking?: boolean;
	/**
	 * Transform Obsidian callouts (`> [!note]`) into styled HTML. Default: `false`.
	 */
	enableCallouts?: boolean;
	/**
	 * Append a backlinks panel to each page listing inbound wikilinks.
	 * Default: `false`.
	 */
	enableBacklinks?: boolean;
	/**
	 * Inline the target of `![[Page]]` / `![[Page#Heading]]` / `![[Page#^block]]`.
	 * Default: `false`.
	 */
	enableTransclusion?: boolean;
	/**
	 * Render `![[image.png]]`, `![[video.mp4]]`, etc. as native HTML media
	 * elements. Default: `false`.
	 */
	enableMediaEmbeds?: boolean;
	/**
	 * Auto-generate `/tags/{name}` index pages for every frontmatter tag.
	 * Requires `enableTagLinking: true` to make inline `#tag` links reach
	 * these pages. Default: `false`.
	 */
	enableTagPages?: boolean;
	/**
	 * Inject the bundled `.obsidian-*` and `.callout-*` stylesheet via the
	 * Rspress `globalStyles` hook. Default: `false`.
	 */
	enableDefaultStyles?: boolean;
}
export interface NormalizedPluginOptions {
	onBrokenLink: DiagnosticMode;
	onAmbiguousLink: DiagnosticMode;
	enableFuzzyMatching: boolean;
	enableCaseInsensitiveLookup: boolean;
	enableMarkdownLinks: boolean;
	onDataviewError: DiagnosticMode;
	enableDataview: boolean;
	enableDailyNotes: boolean;
	dailyNotes: Required<DailyNotesOptions>;
	enableTagLinking: boolean;
	enableCallouts: boolean;
	enableBacklinks: boolean;
	enableTransclusion: boolean;
	enableMediaEmbeds: boolean;
	enableTagPages: boolean;
	enableDefaultStyles: boolean;
}

/**
 * A fragment extracted from a wikilink target.
 *
 * Heading fragments may contain multiple `#`-separated levels because
 * Obsidian supports links such as `[[Page#Heading#Subheading]]`.
 */
export interface WikiSubpath {
	kind: "heading" | "block";
	value: string;
}

/** The structured form of a single wikilink token. */
export interface ParsedWikiLink {
	/** Original source text, including `[[...]]` or `![[...]]` delimiters. */
	raw: string;
	/** The target page or attachment reference. */
	target: string;
	/** Optional alias text after `|`. */
	alias?: string;
	/** `true` for transclusion / media embeds (`![[...]]`). */
	isEmbed: boolean;
	/** Heading or block scope fragment after `#`, if any. */
	subpath?: WikiSubpath;
	/** Vault-wide search syntax (`[[## heading]]` or `[[^^block]]`). */
	search?: "heading" | "block";
	/** `true` for `[[#Heading]]` style links that stay on the current page. */
	isCurrentPageReference: boolean;
}

/** Raw match metadata produced by the tokenizer before parsing. */
export interface WikilinkMatch {
	fullMatch: string;
	inner: string;
	start: number;
	end: number;
}

/** A single heading entry indexed from a page. */
export interface HeadingEntry {
	rawText: string;
	slug: string;
	explicitId?: string;
	/** Short plain-text preview of the content following this heading
	 *  (the first ~200 characters, markdown stripped). Used for tooltip
	 *  previews on heading wikilinks. */
	preview?: string;
}

/** A single block anchor indexed from a page. */
export interface BlockEntry {
	id: string;
}

/** A non-Markdown file that can be addressed by an Obsidian wikilink. */
export interface ContentAsset {
	absolutePath: string;
	relativePath: string;
	pathKey: string;
	baseName: string;
	urlPath: string;
}

/** A Dataview task extracted from a Markdown list item. */
export interface DataviewTask {
	text: string;
	completed: boolean;
	line: number;
	path: string;
	fields: Record<string, unknown>;
}

/** A Dataview list item extracted from a Markdown list. */
export interface DataviewListItem {
	text: string;
	line: number;
	path: string;
	fields: Record<string, unknown>;
}

/** The normalized, searchable representation of a single docs page. */
export interface ContentPage {
	absolutePath: string;
	relativePath: string;
	routePath: string;
	/** Rspress route-oriented key; may collapse an `index.md` suffix. */
	pathKey: string;
	/** Exact vault-relative key with only the Markdown extension removed. */
	filePathKey: string;
	baseName: string;
	title?: string;
	aliases: string[];
	tags: string[];
	cssclasses: string[];
	excerpt?: string;
	publish: boolean;
	fileCtimeMs: number;
	fileMtimeMs: number;
	fileSizeBytes: number;
	headings: HeadingEntry[];
	/** Pre-extracted normalized wikilink targets from this page's content. */
	wikilinkTargets: string[];
	/** Maps slugified heading text → HeadingEntry for O(1) resolution. */
	headingBySlug: Map<string, HeadingEntry>;
	/** Maps normalized (lowercased, single-spaced) raw heading text → first heading. */
	headingByText: Map<string, HeadingEntry>;
	blocks: BlockEntry[];
	/** Frontmatter and inline fields indexed for static Dataview queries. */
	dataviewFields: Record<string, unknown>;
	dataviewTasks: DataviewTask[];
	dataviewLists: DataviewListItem[];
}

/**
 * The pre-computed lookup tables used by the resolver. Produced by
 * {@link import("./content-index.ts").buildContentIndex} or
 * {@link import("./content-index.ts").getCachedContentIndex}.
 */
export interface ContentIndex {
	rootDir: string;
	pages: ContentPage[];
	assets: ContentAsset[];
	byAbsolutePath: Map<string, ContentPage>;
	/** Legacy route-oriented lookup retained for callers inspecting Rspress routes. */
	byPathKey: Map<string, ContentPage>;
	/** Exact vault-relative page lookup, without route `index` collapsing. */
	byFilePathKey: Map<string, ContentPage>;
	byBaseName: Map<string, ContentPage[]>;
	byTitle: Map<string, ContentPage[]>;
	byAlias: Map<string, ContentPage[]>;
	byTag: Map<string, ContentPage[]>;
	byAssetPath: Map<string, ContentAsset>;
	byAssetBaseName: Map<string, ContentAsset[]>;
	/** Case-insensitive pathKey → pages lookup. */
	byPathKeyCI: Map<string, ContentPage[]>;
	/** Case-insensitive exact vault path → pages lookup. */
	byFilePathKeyCI: Map<string, ContentPage[]>;
	/** Case-insensitive basename → pages lookup. */
	byBaseNameCI: Map<string, ContentPage[]>;
	/** Case-insensitive exact vault attachment path → assets lookup. */
	byAssetPathCI: Map<string, ContentAsset[]>;
	/** Case-insensitive attachment basename → assets lookup. */
	byAssetBaseNameCI: Map<string, ContentAsset[]>;
	/** Raw markdown content keyed by absolute path, used by transclusion during the remark pass. */
	rawContentByPath: Map<string, string>;
	/**
	 * Pre-built backlinks map, constructed during content indexing.
	 * Maps each page's routePath to the pages that link to it.
	 * Built once during index construction; no separate pass needed.
	 */
	backlinks: Map<string, BacklinkRef[]>;
}

/**
 * A reference to a page that links to another page, used in the backlinks
 * panel and the pre-built backlinks map on {@link ContentIndex}.
 */
export interface BacklinkRef {
	routePath: string;
	title: string;
}

/** Outcome of attempting to resolve a wikilink. */
export type ResolveStatus =
	| "ok"
	| "broken-page"
	| "broken-anchor"
	| "ambiguous-page";

/**
 * The resolved form of a wikilink. On success, `href` and `label` are set
 * and `targetPage` references the indexed page. On failure, `message`
 * carries a human-readable diagnostic.
 */
export interface ResolvedWikiLink {
	status: ResolveStatus;
	href?: string;
	label?: string;
	targetPage?: ContentPage;
	message?: string;
	/** Plain-text preview of the heading section content, for tooltips. */
	description?: string;
}

/** Input required by {@link import("./resolve-wikilink.ts").resolveWikiLink}. */
export interface ResolveContext {
	currentPage: ContentPage;
	index: ContentIndex;
	options?: Partial<
		Pick<
			NormalizedPluginOptions,
			"enableFuzzyMatching" | "enableCaseInsensitiveLookup"
		>
	>;
}

/**
 * Options accepted by the underlying remark plugin. Normally constructed
 * by the plugin entry; exported for advanced users composing their own
 * unified pipeline.
 */
export interface RemarkWikiLinkPluginOptions {
	getDocsRoot: () => string;
	options: NormalizedPluginOptions;
}
