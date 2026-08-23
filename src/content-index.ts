import fs from "node:fs";
import path from "node:path";
import GithubSlugger from "github-slugger";
import matter from "gray-matter";
import { extractDataviewMetadata } from "./dataview.ts";
import { findWikilinkMatches, parseWikiLink } from "./parse-wikilink.ts";
import { normalizeLookupValue, stripMarkdownFormatting } from "./slug.ts";
import type {
	BacklinkRef,
	BlockEntry,
	ContentAsset,
	ContentIndex,
	ContentPage,
	HeadingEntry,
} from "./types.ts";
import {
	backlinkLabel,
	normalizeFilePathKey,
	normalizeFsPath,
	normalizePathKey,
	resolveRelativePathKey,
} from "./utils.ts";

const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx"]);
const INLINE_TAG_PATTERN =
	/(?<![/\p{L}\p{N}_-])#([\p{L}\p{M}\p{N}\p{Extended_Pictographic}_/-]+)/gu;

/** Maximum number of content indexes to cache simultaneously. Beyond this
 *  the least-recently-used entry is evicted. Rspress dev-server uses a single
 *  root, but tests and tooling may call {@link getCachedContentIndex} with
 *  many different directories in the same process. */
const MAX_CACHED_INDEXES = 10;

interface CacheEntry {
	signature: string;
	index: ContentIndex;
	/** Per-file parse results, keyed by absolute path, so an unchanged file is
	 *  reused across rebuilds instead of being re-read and re-parsed. */
	files: Map<string, ParsedFileEntry>;
}

interface ParsedFileEntry {
	mtimeMs: number;
	size: number;
	page: ContentPage;
	rawMarkdown: string;
}

interface MarkdownFileEntry {
	absolutePath: string;
	relativePath: string;
	ctimeMs: number;
	mtimeMs: number;
	size: number;
}

/** LRU cache keyed by resolved root directory. `Map` preserves insertion
 *  order — on access we delete-then-set to move the entry to the end, and
 *  evict the first entry when over capacity. */
const contentIndexCache = new Map<string, CacheEntry>();
/**
 * Scan `rootDir` for Markdown pages and attachment files, then build a fresh
 * {@link ContentIndex} with pre-computed lookup tables.
 */
export async function buildContentIndex(
	rootDir: string,
): Promise<ContentIndex> {
	const absoluteRoot = path.resolve(rootDir);
	const files = await scanVaultFiles(absoluteRoot);
	return buildContentIndexFromFiles(absoluteRoot, files);
}

/**
 * Like {@link buildContentIndex} but memoized on a per-root basis. The cache
 * is invalidated whenever any routable file changes.
 */
export async function getCachedContentIndex(
	rootDir: string,
): Promise<ContentIndex> {
	const absoluteRoot = path.resolve(rootDir);
	const files = await scanVaultFiles(absoluteRoot);
	const signature = files
		.map((file) => `${file.relativePath}:${file.mtimeMs}:${file.size}`)
		.join("|");

	// Bump existing entry to the end (most-recently-used position).
	const cached = contentIndexCache.get(absoluteRoot);
	if (cached?.signature === signature) {
		contentIndexCache.delete(absoluteRoot);
		contentIndexCache.set(absoluteRoot, cached);
		return cached.index;
	}

	const priorFiles = cached?.files ?? new Map<string, ParsedFileEntry>();
	const index = await buildContentIndexFromFiles(
		absoluteRoot,
		files,
		priorFiles,
	);
	contentIndexCache.set(absoluteRoot, {
		signature,
		index,
		files: priorFiles,
	});

	// Evict least-recently-used entry (first in insertion order) when over cap.
	if (contentIndexCache.size > MAX_CACHED_INDEXES) {
		const oldest = contentIndexCache.keys().next().value;
		if (oldest !== undefined) {
			contentIndexCache.delete(oldest);
		}
	}

	return index;
}

async function buildContentIndexFromFiles(
	rootDir: string,
	files: MarkdownFileEntry[],
	priorFiles?: Map<string, ParsedFileEntry>,
): Promise<ContentIndex> {
	const markdownFiles = files.filter((file) =>
		MARKDOWN_EXTENSIONS.has(path.extname(file.relativePath).toLowerCase()),
	);
	const settled = await Promise.allSettled(
		markdownFiles.map((file) => buildContentPage(file, priorFiles)),
	);
	const pages: ContentPage[] = [];
	const rawContentByPath = new Map<string, string>();
	for (const result of settled) {
		if (result.status === "fulfilled") {
			if (result.value.page.publish) {
				pages.push(result.value.page);
				rawContentByPath.set(
					result.value.page.absolutePath,
					result.value.rawMarkdown,
				);
			}
		} else {
			console.warn(
				`[rspress-plugin-obsidian-wikilink] Failed to index file: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
			);
		}
	}
	const assets: ContentAsset[] = files
		.filter(
			(file) =>
				!MARKDOWN_EXTENSIONS.has(path.extname(file.relativePath).toLowerCase()),
		)
		.map((file) => ({
			absolutePath: file.absolutePath,
			relativePath: file.relativePath,
			pathKey: normalizePathKey(file.relativePath),
			baseName: path.basename(file.relativePath),
			urlPath: `/${file.relativePath
				.split("/")
				.map((segment) => encodeURIComponent(segment))
				.join("/")}`,
		}));
	const byAbsolutePath = new Map<string, ContentPage>();
	const byPathKey = new Map<string, ContentPage>();
	const byFilePathKey = new Map<string, ContentPage>();
	const byBaseName = new Map<string, ContentPage[]>();
	const byTitle = new Map<string, ContentPage[]>();
	const byAlias = new Map<string, ContentPage[]>();
	const byTag = new Map<string, ContentPage[]>();
	const byAssetPath = new Map<string, ContentAsset>();
	const byAssetBaseName = new Map<string, ContentAsset[]>();
	const byPathKeyCI = new Map<string, ContentPage[]>();
	const byFilePathKeyCI = new Map<string, ContentPage[]>();
	const byBaseNameCI = new Map<string, ContentPage[]>();
	const byAssetPathCI = new Map<string, ContentAsset[]>();
	const byAssetBaseNameCI = new Map<string, ContentAsset[]>();

	for (const page of pages) {
		byAbsolutePath.set(page.absolutePath, page);
		byPathKey.set(page.pathKey, page);
		byFilePathKey.set(page.filePathKey, page);

		pushNamedPage(byPathKeyCI, page.pathKey.toLowerCase(), page);
		pushNamedPage(byFilePathKeyCI, page.filePathKey.toLowerCase(), page);

		if (page.baseName.length > 0) {
			const existing = byBaseName.get(page.baseName) ?? [];
			existing.push(page);
			byBaseName.set(page.baseName, existing);

			pushNamedPage(byBaseNameCI, page.baseName.toLowerCase(), page);
		}

		if (page.title) {
			pushNamedPage(byTitle, page.title, page);
		}

		for (const alias of page.aliases) {
			pushNamedPage(byAlias, alias, page);
		}

		for (const tag of page.tags) {
			pushNamedPage(byTag, tag, page);
			// For nested tags like "parent/child/leaf", also aggregate into
			// each ancestor segment so byTag["parent"] includes the page too.
			const parts = tag.split("/");
			for (let depth = 1; depth < parts.length; depth++) {
				pushNamedPage(byTag, parts.slice(0, depth).join("/"), page);
			}
		}
	}
	for (const asset of assets) {
		byAssetPath.set(asset.pathKey, asset);
		pushNamedAsset(byAssetPathCI, asset.pathKey.toLowerCase(), asset);
		const existing = byAssetBaseName.get(asset.baseName) ?? [];
		existing.push(asset);
		byAssetBaseName.set(asset.baseName, existing);
		pushNamedAsset(byAssetBaseNameCI, asset.baseName.toLowerCase(), asset);
	}

	const backlinks = new Map<string, BacklinkRef[]>();
	for (const page of pages) {
		for (const normalizedTarget of page.wikilinkTargets) {
			const resolved = resolveBacklinkTarget(
				byFilePathKey,
				byFilePathKeyCI,
				byBaseName,
				byBaseNameCI,
				byTitle,
				byAlias,
				normalizedTarget,
				page,
			);
			for (const candidate of resolved) {
				if (candidate.absolutePath === page.absolutePath) continue;
				addBacklinkEntry(backlinks, candidate.routePath, page);
			}
		}
	}

	return {
		rootDir,
		pages,
		assets,
		byAbsolutePath,
		byPathKey,
		byFilePathKey,
		byBaseName,
		byTitle,
		byAlias,
		byTag,
		byAssetPath,
		byAssetBaseName,
		byPathKeyCI,
		byFilePathKeyCI,
		byBaseNameCI,
		byAssetPathCI,
		byAssetBaseNameCI,
		rawContentByPath,
		backlinks,
	};
}
function resolveBacklinkTarget(
	byFilePathKey: Map<string, ContentPage>,
	byFilePathKeyCI: Map<string, ContentPage[]>,
	byBaseName: Map<string, ContentPage[]>,
	byBaseNameCI: Map<string, ContentPage[]>,
	byTitle: Map<string, ContentPage[]>,
	byAlias: Map<string, ContentPage[]>,
	normalizedTarget: string,
	sourcePage: ContentPage,
): ContentPage[] {
	const seen = new Set<string>();
	const results: ContentPage[] = [];

	const addPage = (page: ContentPage) => {
		if (!seen.has(page.absolutePath)) {
			seen.add(page.absolutePath);
			results.push(page);
		}
	};

	const relativePathKey = resolveRelativePathKey(
		sourcePage.relativePath,
		normalizedTarget,
	);
	if (relativePathKey !== undefined) {
		const relativePages = byFilePathKeyCI.get(relativePathKey.toLowerCase());
		if (relativePages) {
			for (const page of relativePages) {
				addPage(page);
			}
		}
		return results;
	}

	const exactPage = byFilePathKey.get(normalizedTarget);
	if (exactPage) {
		addPage(exactPage);
		return results;
	}

	const exactCaseInsensitivePage = byFilePathKeyCI.get(
		normalizedTarget.toLowerCase(),
	);
	if (exactCaseInsensitivePage) {
		for (const page of exactCaseInsensitivePage) {
			addPage(page);
		}
		return results;
	}

	const baseName = path.basename(normalizedTarget) || normalizedTarget;
	const baseNameCandidates = byBaseName.get(baseName);
	if (baseNameCandidates) {
		for (const page of baseNameCandidates) {
			addPage(page);
		}
	}

	if (results.length === 0) {
		const ciBaseCandidates = byBaseNameCI.get(baseName);
		if (ciBaseCandidates) {
			for (const page of ciBaseCandidates) {
				addPage(page);
			}
		}
	}

	// Frontmatter title and alias lookups: targets are already lowercased and
	// slash-normalized during extraction, but title/alias keys are additionally
	// whitespace-normalized by normalizeLookupValue. Apply the same fold before
	// consulting those maps so `[[My Alias]]` records a backlink.
	if (results.length === 0) {
		const folded = normalizeLookupValue(normalizedTarget);
		for (const page of byTitle.get(folded) ?? []) {
			addPage(page);
		}
		for (const page of byAlias.get(folded) ?? []) {
			addPage(page);
		}
	}

	return results;
}

function addBacklinkEntry(
	backlinks: Map<string, BacklinkRef[]>,
	targetRoutePath: string,
	sourcePage: ContentPage,
): void {
	const existing = backlinks.get(targetRoutePath) ?? [];
	const already = existing.some((e) => e.routePath === sourcePage.routePath);
	if (!already) {
		existing.push({
			routePath: sourcePage.routePath,
			title: backlinkLabel(sourcePage),
		});
		backlinks.set(targetRoutePath, existing);
	}
}

async function scanVaultFiles(rootDir: string): Promise<MarkdownFileEntry[]> {
	const results: MarkdownFileEntry[] = [];
	const queue: string[] = [rootDir];

	while (queue.length > 0) {
		const currentDir = queue.shift();
		if (!currentDir) {
			continue;
		}

		const entries = await fs.promises.readdir(currentDir, {
			withFileTypes: true,
		});

		const subdirs: string[] = [];
		const fileStats: Promise<MarkdownFileEntry | undefined>[] = [];

		for (const entry of entries) {
			const absolutePath = path.join(currentDir, entry.name);

			if (entry.isDirectory()) {
				if (
					entry.name === ".git" ||
					entry.name === "node_modules" ||
					entry.name.startsWith(".")
				) {
					continue;
				}
				subdirs.push(absolutePath);
				continue;
			}

			if (!entry.isFile()) {
				continue;
			}

			const relativePath = normalizeFsPath(
				path.relative(rootDir, absolutePath),
			);
			if (!isRoutableRelativePath(relativePath)) {
				continue;
			}

			fileStats.push(
				fs.promises
					.stat(absolutePath)
					.then((stats) => ({
						absolutePath: normalizeFsPath(path.resolve(absolutePath)),
						relativePath,
						ctimeMs: stats.ctimeMs,
						mtimeMs: stats.mtimeMs,
						size: stats.size,
					}))
					.catch(() => undefined),
			);
		}

		const settled = await Promise.all(fileStats);
		for (const entry of settled) {
			if (entry !== undefined) {
				results.push(entry);
			}
		}

		queue.push(...subdirs);
	}

	results.sort((left, right) =>
		left.relativePath.localeCompare(right.relativePath),
	);
	return results;
}

function isRoutableRelativePath(relativePath: string): boolean {
	return relativePath.split("/").every((segment) => !/^_[^_]/.test(segment));
}

async function buildContentPage(
	file: MarkdownFileEntry,
	priorFiles?: Map<string, ParsedFileEntry>,
): Promise<{
	page: ContentPage;
	rawMarkdown: string;
}> {
	const cached = priorFiles?.get(file.absolutePath);
	if (cached && cached.mtimeMs === file.mtimeMs && cached.size === file.size) {
		return { page: cached.page, rawMarkdown: cached.rawMarkdown };
	}
	const markdown = await fs.promises.readFile(file.absolutePath, "utf-8");
	const routePath = deriveRoutePath(file.relativePath);
	const pathKey = normalizePathKey(file.relativePath);
	const filePathKey = normalizeFilePathKey(file.relativePath);
	const baseName = path.basename(filePathKey);
	const metadata = extractFrontmatterMetadata(markdown);
	const { title, aliases, tags, cssclasses, excerpt, publish } = metadata;
	const dataview = extractDataviewMetadata(
		markdown,
		metadata.frontmatter,
		file.relativePath,
	);

	const lines = markdown.split(/\r?\n/);
	const isContent = getContentLineFlags(lines);
	const allTags = [
		...new Set([...tags, ...extractInlineTags(lines, isContent)]),
	];
	const headings = extractHeadings(lines, isContent);

	// Pre-extract referenced page targets while we have the raw content in
	// memory. Restricted to content lines so references inside code fences,
	// inline code, comments, and frontmatter do not create backlinks.
	const wikilinkTargets = extractWikilinkTargets(lines, isContent);

	const headingBySlug = new Map<string, HeadingEntry>();
	const headingByText = new Map<string, HeadingEntry>();
	for (const h of headings) {
		headingBySlug.set(h.slug, h);
		if (h.explicitId) {
			headingBySlug.set(h.explicitId, h);
			headingBySlug.set(normalizeLookupValue(h.explicitId), h);
		}
		const normalizedText = normalizeLookupValue(h.rawText);
		if (!headingByText.has(normalizedText)) {
			headingByText.set(normalizedText, h);
		}
	}
	const blocks = extractBlocks(lines, isContent);
	const page: ContentPage = {
		absolutePath: file.absolutePath,
		title,
		relativePath: file.relativePath,
		routePath,
		pathKey,
		filePathKey,
		baseName,
		tags: allTags,
		aliases,
		cssclasses,
		excerpt,
		publish,
		fileCtimeMs: file.ctimeMs,
		fileMtimeMs: file.mtimeMs,
		fileSizeBytes: file.size,
		headings,
		wikilinkTargets,
		headingBySlug,
		headingByText,
		blocks,
		dataviewFields: dataview.fields,
		dataviewTasks: dataview.tasks,
		dataviewLists: dataview.lists,
	};

	const entry: ParsedFileEntry = {
		mtimeMs: file.mtimeMs,
		size: file.size,
		page,
		rawMarkdown: markdown,
	};
	priorFiles?.set(file.absolutePath, entry);

	return { page, rawMarkdown: markdown };
}

function deriveRoutePath(relativePath: string): string {
	const withoutExtension = relativePath.replace(/\.(md|mdx)$/i, "");
	const routeKey = normalizePathKey(withoutExtension);
	return routeKey.length === 0 ? "/" : `/${routeKey}`;
}

export { normalizePathKey } from "./utils.ts";

function getContentLineFlags(lines: string[]): boolean[] {
	const flags = new Array<boolean>(lines.length).fill(false);
	let inFence = false;
	let inFrontmatter = lines[0]?.trim() === "---";

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";

		if (inFrontmatter) {
			if (index > 0 && line.trim() === "---") {
				inFrontmatter = false;
			}
			continue;
		}

		if (/^(```|~~~)/.test(line.trim())) {
			inFence = !inFence;
			continue;
		}

		if (inFence) {
			continue;
		}

		flags[index] = true;
	}

	return flags;
}

function extractHeadings(
	lines: string[],
	isContent: boolean[],
): HeadingEntry[] {
	const slugger = new GithubSlugger();
	const headings: HeadingEntry[] = [];
	const headingLineIndexes: number[] = [];

	for (let index = 0; index < lines.length; index += 1) {
		if (!isContent[index]) {
			continue;
		}

		const line = lines[index] ?? "";

		const atxMatch = /^\s{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
		if (atxMatch) {
			pushHeading(headings, slugger, atxMatch[2] ?? "");
			headingLineIndexes.push(index);
			continue;
		}

		const nextLine = lines[index + 1] ?? "";
		if (!/^\s{0,3}(=+|-+)\s*$/.test(nextLine)) {
			continue;
		}

		const rawHeading = line.trim();
		if (rawHeading.length === 0) {
			continue;
		}

		pushHeading(headings, slugger, rawHeading);
		headingLineIndexes.push(index);
		index += 1; // skip the setext underline on the next iteration
	}

	// Second pass: extract preview text after each heading.
	// Collects content lines until the next heading at the same or higher level,
	// strips markdown formatting, and truncates to MAX_PREVIEW_LENGTH chars.
	// Extracted buildingContentPage allows showing tooltip previews on hover.
	const MAX_PREVIEW_LENGTH = 200;
	for (let h = 0; h < headings.length; h++) {
		const idx = headingLineIndexes[h];
		if (idx === undefined) continue;
		const startLine = idx + 1;
		const endLine =
			h + 1 < headings.length
				? (headingLineIndexes[h + 1] ?? lines.length)
				: lines.length;
		const previewLines: string[] = [];
		let charCount = 0;

		for (
			let i = startLine;
			i < endLine && charCount < MAX_PREVIEW_LENGTH;
			i++
		) {
			if (!isContent[i]) continue;
			const text = stripMarkdownFormatting(lines[i] ?? "").trim();
			if (!text) continue;
			const remaining = MAX_PREVIEW_LENGTH - charCount;
			previewLines.push(
				text.length <= remaining ? text : text.slice(0, remaining),
			);
			charCount += text.length;
		}

		if (previewLines.length > 0) {
			const entry = headings[h];
			if (entry) entry.preview = previewLines.join(" ");
		}
	}

	return headings;
}

function extractBlocks(lines: string[], isContent: boolean[]): BlockEntry[] {
	const blocks: BlockEntry[] = [];
	const seen = new Set<string>();

	for (let index = 0; index < lines.length; index += 1) {
		if (!isContent[index]) {
			continue;
		}

		const line = lines[index] ?? "";

		const standaloneMatch = /^\^([A-Za-z0-9_-]+)\s*$/.exec(line.trim());
		if (standaloneMatch?.[1]) {
			pushBlock(blocks, seen, standaloneMatch[1]);
			continue;
		}

		// Inline block ID: "Paragraph text ^block-id" appended at end of line
		const inlineBlockMatch = /\s\^([A-Za-z0-9_-]+)\s*$/.exec(line);
		if (inlineBlockMatch?.[1]) {
			pushBlock(blocks, seen, inlineBlockMatch[1]);
		}
	}

	return blocks;
}

/**
 * Extract unique normalized wikilink targets from a page's content lines.
 *
 * Only lines flagged as content by {@link getContentLineFlags} are scanned, and
 * inline code spans and `%% ... %%` comments are stripped first, so wikilinks
 * that never render as links (code blocks, inline code, comments, frontmatter)
 * do not create backlinks. The targets are lowercased, backslash-normalized,
 * and stripped of alias (`|...`) and anchor (`#...`) fragments — matching
 * exactly what the backlinks resolver needs, so it can skip regex scanning
 * entirely.
 */
function extractWikilinkTargets(
	lines: string[],
	isContent: boolean[],
): string[] {
	const seen = new Set<string>();
	const targets: string[] = [];

	const content = lines
		.filter((_, index) => isContent[index])
		.join("\n")
		.replace(/(`+)[^`\n]*?\1/g, " ")
		.replace(/%%[\s\S]*?%%/g, " ");

	for (const match of findWikilinkMatches(content)) {
		const parsed = parseWikiLink(match.inner, match.fullMatch);
		const target = parsed.target;
		if (target) {
			const normalized = target.replace(/\\/g, "/").toLowerCase();
			if (!seen.has(normalized)) {
				seen.add(normalized);
				targets.push(normalized);
			}
		}
	}

	const markdownLinkPattern =
		/!?\[[^\]]*\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+["'][^)]*)?\)/g;
	for (const match of content.matchAll(markdownLinkPattern)) {
		let target = match[1]?.trim() ?? "";
		if (target.startsWith("<") && target.endsWith(">")) {
			target = target.slice(1, -1);
		}
		if (
			!target ||
			/^[a-z][a-z0-9+.-]*:/i.test(target) ||
			target.startsWith("//") ||
			target.startsWith("#")
		) {
			continue;
		}

		const hashIndex = target.indexOf("#");
		const pathPart = hashIndex >= 0 ? target.slice(0, hashIndex) : target;
		if (!/\.(md|mdx)$/i.test(pathPart)) {
			continue;
		}

		let normalized = pathPart.replace(/\.(md|mdx)$/i, "");
		try {
			normalized = decodeURIComponent(normalized);
		} catch {
			// Keep the raw path when a malformed escape appears in a link.
		}
		normalized = normalized.replace(/\\/g, "/").toLowerCase();
		if (!seen.has(normalized)) {
			seen.add(normalized);
			targets.push(normalized);
		}
	}

	return targets;
}
function extractInlineTags(lines: string[], isContent: boolean[]): string[] {
	const tags = new Set<string>();

	for (let index = 0; index < lines.length; index += 1) {
		if (!isContent[index]) continue;
		for (const match of (lines[index] ?? "").matchAll(INLINE_TAG_PATTERN)) {
			const tag = (match[1] ?? "").replace(/\/+$/, "");
			if (tag && !/^[\p{N}/-]+$/u.test(tag)) {
				tags.add(tag);
			}
		}
	}

	return [...tags];
}

function pushBlock(blocks: BlockEntry[], seen: Set<string>, id: string): void {
	const normalizedId = id.trim();
	if (!normalizedId || seen.has(normalizedId)) {
		return;
	}

	seen.add(normalizedId);
	blocks.push({ id: normalizedId });
}

function pushHeading(
	headings: HeadingEntry[],
	slugger: GithubSlugger,
	rawHeading: string,
): void {
	const trimmedHeading = rawHeading.trim();
	const explicitIdMatch = trimmedHeading.match(
		/\s*\{#([A-Za-z0-9_:.-]+)\}\s*$/,
	);
	const explicitId = explicitIdMatch?.[1];
	const headingText = explicitIdMatch
		? trimmedHeading
				.slice(0, trimmedHeading.length - explicitIdMatch[0].length)
				.trim()
		: trimmedHeading;
	const normalizedText = stripMarkdownFormatting(headingText);

	if (normalizedText.length === 0) {
		return;
	}

	headings.push({
		rawText: normalizedText,
		slug: slugger.slug(normalizedText),
		explicitId,
	});
}

function normalizeStringField(value: unknown): string | undefined {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	}
	return undefined;
}

function normalizeBooleanField(value: unknown): boolean {
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "string") {
		const lowered = value.trim().toLowerCase();
		return lowered === "true" || lowered === "yes" || lowered === "1";
	}
	if (typeof value === "number") {
		return value !== 0;
	}
	return true;
}

function normalizeStringArray(value: unknown): string[] {
	if (!value) return [];
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!trimmed) return [];
		return [trimmed];
	}
	if (Array.isArray(value)) {
		return value
			.filter((v): v is string => typeof v === "string")
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
	}
	return [];
}

function extractFrontmatterMetadata(markdown: string): {
	title?: string;
	aliases: string[];
	tags: string[];
	cssclasses: string[];
	excerpt?: string;
	publish: boolean;
	frontmatter: Record<string, unknown>;
} {
	try {
		const parsed = matter(markdown);
		const data = parsed.data || {};

		const title = normalizeStringField(data.title);
		const excerpt = normalizeStringField(data.excerpt);
		const aliases = normalizeStringArray(data.aliases ?? data.alias);
		const tags = normalizeStringArray(data.tags ?? data.tag);
		const cssclasses = normalizeStringArray(data.cssclasses ?? data.cssclass);
		const publish = normalizeBooleanField(data.publish);

		return {
			title,
			excerpt,
			aliases: [...new Set(aliases)],
			tags: [...new Set(tags)],
			cssclasses: [...new Set(cssclasses)],
			publish,
			frontmatter: data,
		};
	} catch {
		return {
			aliases: [],
			tags: [],
			cssclasses: [],
			publish: true,
			frontmatter: {},
		};
	}
}

function pushNamedPage(
	map: Map<string, ContentPage[]>,
	rawValue: string,
	page: ContentPage,
): void {
	const key = normalizeLookupValue(rawValue);
	if (!key) {
		return;
	}

	const existing = map.get(key) ?? [];
	existing.push(page);
	map.set(key, existing);
}

function pushNamedAsset(
	map: Map<string, ContentAsset[]>,
	rawValue: string,
	asset: ContentAsset,
): void {
	if (!rawValue) {
		return;
	}
	const existing = map.get(rawValue) ?? [];
	existing.push(asset);
	map.set(rawValue, existing);
}

export { normalizeFsPath } from "./utils.ts";
