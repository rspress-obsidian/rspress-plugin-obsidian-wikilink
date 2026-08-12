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
	 * Enable case-insensitive path and basename fallback. Default: `false`.
	 */
	enableCaseInsensitiveLookup?: boolean;
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

/**
 * Plugin options with all defaults resolved. Produced internally by the
 * plugin entry; consumers do not normally construct this type directly.
 */
export interface NormalizedPluginOptions {
	onBrokenLink: DiagnosticMode;
	onAmbiguousLink: DiagnosticMode;
	enableFuzzyMatching: boolean;
	enableCaseInsensitiveLookup: boolean;
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

/** The normalized, searchable representation of a single docs page. */
export interface ContentPage {
	absolutePath: string;
	relativePath: string;
	routePath: string;
	pathKey: string;
	baseName: string;
	title?: string;
	aliases: string[];
	tags: string[];
	cssclasses: string[];
	excerpt?: string;
	publish: boolean;
	headings: HeadingEntry[];
	/** Pre-extracted normalized wikilink targets from this page's content. */
	wikilinkTargets: string[];
	/** Maps slugified heading text → HeadingEntry for O(1) resolution. */
	headingBySlug: Map<string, HeadingEntry>;
	/** Maps normalized (lowercased, single-spaced) raw heading text → HeadingEntry. */
	headingByText: Map<string, HeadingEntry>;
	blocks: BlockEntry[];
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
	byPathKey: Map<string, ContentPage>;
	byBaseName: Map<string, ContentPage[]>;
	byTitle: Map<string, ContentPage[]>;
	byAlias: Map<string, ContentPage[]>;
	byTag: Map<string, ContentPage[]>;
	byAssetPath: Map<string, ContentAsset>;
	byAssetBaseName: Map<string, ContentAsset[]>;
	/** Case-insensitive pathKey → pages lookup. Populated when `enableFuzzyMatching` is available. */
	byPathKeyCI: Map<string, ContentPage[]>;
	/** Case-insensitive basename → pages lookup. Populated when `enableCaseInsensitiveLookup` is available. */
	byBaseNameCI: Map<string, ContentPage[]>;
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
