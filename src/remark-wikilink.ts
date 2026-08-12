import fs from "node:fs";
import path from "node:path";
import type {
	Blockquote,
	HTML,
	Link,
	PhrasingContent,
	Root,
	Text,
} from "mdast";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { type RemarkPluginFactory, unistVisit } from "rspress-plugin-devkit";
import { unified } from "unified";
import type { Parent } from "unist";
import type { VFile } from "vfile";
import { getCachedBacklinksIndex, renderBacklinksHtml } from "./backlinks.ts";
import { getCachedContentIndex } from "./content-index.ts";
import { findWikilinkMatches, parseWikiLink } from "./parse-wikilink.ts";
import { resolveWikiLink } from "./resolve-wikilink.ts";
import { encodeTagPathSegment } from "./tag-pages.ts";
import type {
	ContentIndex,
	ContentPage,
	NormalizedPluginOptions,
	RemarkWikiLinkPluginOptions,
} from "./types.ts";
import {
	formatAvailableBlocks,
	formatAvailableHeadings,
	normalizeFsPath,
} from "./utils.ts";

// Obsidian tags accept letters, numbers, symbols, emojis, hyphens, and
// nested-slash segments, but must contain at least one non-numeric character.
const TAG_PATTERN =
	/(?<![/\p{L}\p{N}_-])#([\p{L}\p{M}\p{N}\p{Extended_Pictographic}_/-]+)/gu;
// Capture optional fold operator: '+' = expanded, '-' = collapsed, absent = static
const CALLOUT_HEADER_PATTERN = /^\[!(\w+)\]([-+])?\s*(.*)$/;
// Obsidian inline and block comments: %% ... %%
const COMMENT_PATTERN = /%%[\s\S]*?%%/g;
// Obsidian text highlighting: ==text==
const HIGHLIGHT_PATTERN = /==([^=]+)==/g;
// Obsidian footnotes: [^1] reference, [^1]: definition, and ^[inline text]
const FOOTNOTE_REF_PATTERN = /(?<!\[)\[\^([^\]]+)\](?!:)/g;
const FOOTNOTE_DEF_PATTERN = /^\[\^([^\]]+)\]:[ \t]*(.*(?:\n[ \t]{2,}.*)*)$/gm;
const INLINE_FOOTNOTE_PATTERN = /\^\[([^\]]+)\]/g;

const WIKILINK_EMBED_PATTERN = /!\[\[([^\]]+)\]\]/g;

const MAX_TRANSCLUSION_DEPTH = 5;

const IMAGE_EXTS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"svg",
	"webp",
	"avif",
]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "m4a", "flac"]);
const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "mkv"]);
const PDF_EXT = "pdf";

// Maps Obsidian callout type aliases to their canonical CSS class.
const CALLOUT_TYPE_ALIASES: Record<string, string> = {
	abstract: "abstract",
	summary: "abstract",
	tldr: "abstract",
	check: "success",
	done: "success",
	help: "question",
	faq: "question",
	hint: "tip",
	important: "tip",
	caution: "caution",
	attention: "caution",
	failure: "failure",
	fail: "failure",
	missing: "failure",
	error: "danger",
	cite: "quote",
};

const SKIP_PARENT_TYPES = new Set([
	"link",
	"linkReference",
	"definition",
	"inlineCode",
	"code",
	"html",
	"mdxJsxTextElement",
	"mdxJsxFlowElement",
	"mdxFlowExpression",
	"mdxTextExpression",
]);

/**
 * Resolve all wikilink tokens in `tree` by replacing them with `link` or
 * `html` AST nodes. Operates synchronously so it can be reused inside
 * transclusion handling.
 *
 * When `file` is provided, broken/ambiguous links are reported through the
 * VFile diagnostic API. When omitted (e.g. for transcluded sub-documents),
 * unresolved links are silently left as raw text.
 */
function resolveWikilinksInAst(
	tree: Root,
	currentPage: ContentPage,
	index: ContentIndex,
	options: NormalizedPluginOptions,
	file?: VFile,
): void {
	const resolveOptions = {
		enableFuzzyMatching: options.enableFuzzyMatching,
		enableCaseInsensitiveLookup: options.enableCaseInsensitiveLookup,
	};

	unistVisit(tree, "text", (node, position, parent) => {
		if (!parent || typeof position !== "number") {
			return;
		}

		if (SKIP_PARENT_TYPES.has(parent.type)) {
			return;
		}

		const matches = findWikilinkMatches(node.value);
		if (matches.length === 0) {
			return;
		}

		const replacementNodes: PhrasingContent[] = [];
		let cursor = 0;

		for (const match of matches) {
			if (match.start > cursor) {
				replacementNodes.push(
					createTextNode(node.value.slice(cursor, match.start)),
				);
			}

			const parsed = parseWikiLink(match.inner, match.fullMatch);
			const resolved = resolveWikiLink(parsed, {
				currentPage,
				index,
				options: resolveOptions,
			});

			if (resolved.status === "ok") {
				const href = resolved.href;
				const label = resolved.label;

				if (href && label) {
					replacementNodes.push(
						parsed.isEmbed
							? createEmbedNode(href, label)
							: createLinkNode(href, label, resolved.description),
					);
				} else {
					replacementNodes.push(createTextNode(parsed.raw));
				}
			} else {
				if (file) {
					reportDiagnostic(
						file,
						parsed.raw,
						resolved.message ?? "Unable to resolve wikilink.",
						resolved.status,
						options,
					);
				}
				replacementNodes.push(createTextNode(parsed.raw));
			}

			cursor = match.end;
		}

		if (cursor < node.value.length) {
			replacementNodes.push(createTextNode(node.value.slice(cursor)));
		}

		const parentWithChildren = parent as Parent & {
			children: PhrasingContent[];
		};
		parentWithChildren.children.splice(position, 1, ...replacementNodes);
	});
}

export const remarkWikilink: RemarkPluginFactory<RemarkWikiLinkPluginOptions> =
	({ getDocsRoot, options }) =>
	async (tree: Root, file: VFile): Promise<void> => {
		try {
			await remarkWikilinkInner(tree, file, getDocsRoot, options);
		} catch (error) {
			file.message(
				`[rspress-plugin-obsidian-wikilink] Unexpected error processing ${file.path ?? "unknown file"}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	};

async function remarkWikilinkInner(
	tree: Root,
	file: VFile,
	getDocsRoot: () => string,
	options: NormalizedPluginOptions,
	currentFilePathOverride?: string,
	includePageDecorations = true,
	visitedOverride?: Set<string>,
	depth = 0,
	sourceContent?: string,
): Promise<void> {
	const docsRoot = getDocsRoot();
	const index = await getCachedContentIndex(docsRoot);
	const currentFilePath = currentFilePathOverride ?? getCurrentFilePath(file);

	if (!currentFilePath) {
		return;
	}

	const currentPage = index.byAbsolutePath.get(currentFilePath);
	if (!currentPage) {
		file.message(
			`[rspress-plugin-obsidian-wikilink] File "${currentFilePath}" not found in content index — wikilink processing skipped.`,
		);
		return;
	}
	const footnoteSourceMetadata = extractFootnoteSourceMetadata(
		sourceContent ?? String(file),
	);

	// Strip Obsidian comments (%% ... %%) before all other transforms.
	unistVisit(tree, "text", (node, position, parent) => {
		if (!node.value.includes("%%")) return;
		const stripped = node.value.replace(COMMENT_PATTERN, "");
		if (stripped === node.value) return;

		if (
			stripped.trim().length === 0 &&
			parent &&
			typeof position === "number"
		) {
			// Remove the now-empty text node from its parent
			(parent as Parent & { children: unknown[] }).children.splice(position, 1);
			return;
		}

		node.value = stripped;
	});

	// Transform Obsidian text highlighting ==text== to <mark> tags
	unistVisit(tree, "text", (node, position, parent) => {
		if (!parent || typeof position !== "number") {
			return;
		}

		if (SKIP_PARENT_TYPES.has(parent.type)) {
			return;
		}

		const text = node.value;
		if (!text.includes("==")) {
			return;
		}

		const matches = [...text.matchAll(HIGHLIGHT_PATTERN)];
		if (matches.length === 0) {
			return;
		}

		const replacementNodes: PhrasingContent[] = [];
		let cursor = 0;

		for (const match of matches) {
			const start = match.index ?? 0;
			const fullMatch = match[0];
			const inner = match[1] ?? "";

			if (start > cursor) {
				replacementNodes.push(createTextNode(text.slice(cursor, start)));
			}

			replacementNodes.push(createHighlightNode(inner));
			cursor = start + fullMatch.length;
		}

		if (cursor < text.length) {
			replacementNodes.push(createTextNode(text.slice(cursor)));
		}

		const parentWithChildren = parent as Parent & {
			children: PhrasingContent[];
		};
		parentWithChildren.children.splice(position, 1, ...replacementNodes);
	});

	// Transform Obsidian footnotes — two-pass approach.
	// Pass 1 (read-only): collect all label-based definitions across the whole tree
	// so that title attributes are correct even when defs appear after their refs.
	const footnoteDefs = new Map<string, string>();
	const footnoteDupeLabels = new Set<string>();
	unistVisit(tree, "text", (node) => {
		if (!node.value.includes("[^")) return;
		for (const m of node.value.matchAll(FOOTNOTE_DEF_PATTERN)) {
			const label = m[1] ?? "";
			const content = normalizeFootnoteContent(m[2] ?? "");
			if (label && content) {
				if (footnoteDefs.has(label)) {
					footnoteDupeLabels.add(label);
				}
				footnoteDefs.set(label, content);
			}
		}
	});
	for (const [label, content] of footnoteSourceMetadata.definitions) {
		const existing = footnoteDefs.get(label);
		if (!existing || content.length > existing.length) {
			footnoteDefs.set(label, content);
		}
	}

	if (footnoteSourceMetadata.continuationLineNumbers.size > 0) {
		unistVisit(tree, "text", (node, position, parent) => {
			if (!parent || typeof position !== "number") return;
			if (parent.type !== "paragraph") return;
			const lineNumber = node.position?.start.line;
			if (
				typeof lineNumber === "number" &&
				footnoteSourceMetadata.continuationLineNumbers.has(lineNumber)
			) {
				(parent as Parent & { children: unknown[] }).children.splice(
					position,
					1,
				);
			}
		});
	}

	if (footnoteDupeLabels.size > 0) {
		file.message(
			`[rspress-plugin-obsidian-wikilink:footnote] Duplicate footnote label${footnoteDupeLabels.size > 1 ? "s" : ""}: ${[...footnoteDupeLabels].join(", ")}. Later definitions overwrite earlier ones.`,
		);
	}

	// Pass 2: strip definition lines, transform label refs, transform inline fns.
	let inlineFnCounter = 0;
	const inlineFnDefs: Array<{ id: string; content: string }> = [];

	unistVisit(tree, "text", (node, position, parent) => {
		if (!parent || typeof position !== "number") return;
		if (SKIP_PARENT_TYPES.has(parent.type)) return;

		const text = node.value;
		const hasLabelFn = text.includes("[^");
		const hasInlineFn = text.includes("^[");
		if (!hasLabelFn && !hasInlineFn) return;

		interface FnMatch {
			kind: "ref" | "def" | "inline";
			start: number;
			end: number;
			label: string;
			content: string;
		}

		const allMatches: FnMatch[] = [];

		if (hasLabelFn) {
			for (const m of text.matchAll(FOOTNOTE_DEF_PATTERN)) {
				allMatches.push({
					kind: "def",
					start: m.index ?? 0,
					end: (m.index ?? 0) + m[0].length,
					label: m[1] ?? "",
					content: normalizeFootnoteContent(m[2] ?? ""),
				});
			}
			for (const m of text.matchAll(FOOTNOTE_REF_PATTERN)) {
				allMatches.push({
					kind: "ref",
					start: m.index ?? 0,
					end: (m.index ?? 0) + m[0].length,
					label: m[1] ?? "",
					content: "",
				});
			}
		}

		if (hasInlineFn) {
			for (const m of text.matchAll(INLINE_FOOTNOTE_PATTERN)) {
				allMatches.push({
					kind: "inline",
					start: m.index ?? 0,
					end: (m.index ?? 0) + m[0].length,
					label: "",
					content: m[1] ?? "",
				});
			}
		}

		if (allMatches.length === 0) return;

		allMatches.sort((a, b) => a.start - b.start);

		const replacementNodes: PhrasingContent[] = [];
		let cursor = 0;

		for (const match of allMatches) {
			if (match.start > cursor) {
				replacementNodes.push(createTextNode(text.slice(cursor, match.start)));
			}

			if (match.kind === "def") {
				// Definition lines are stripped — not included in output.
			} else if (match.kind === "ref") {
				const def = footnoteDefs.get(match.label);
				const title = def ? ` title="${escapeHtmlAttribute(def)}"` : "";
				replacementNodes.push({
					type: "html",
					value: `<sup class="footnote-ref" id="fnref-${escapeHtmlAttribute(match.label)}"><a href="#fn-${escapeHtmlAttribute(match.label)}"${title}>${escapeHtmlText(match.label)}</a></sup>`,
				});
			} else {
				// inline footnote: ^[text]
				inlineFnCounter++;
				const id = `inline-${inlineFnCounter}`;
				inlineFnDefs.push({ id, content: match.content });
				replacementNodes.push({
					type: "html",
					value: `<sup class="footnote-ref" id="fnref-${id}"><a href="#fn-${id}" title="${escapeHtmlAttribute(match.content)}">${inlineFnCounter}</a></sup>`,
				});
			}

			cursor = match.end;
		}

		if (cursor < text.length) {
			replacementNodes.push(createTextNode(text.slice(cursor)));
		}

		const parentWithChildren = parent as Parent & {
			children: PhrasingContent[];
		};

		// If the node was only definition text it's now empty — remove it.
		const nonEmpty = replacementNodes.filter(
			(n): n is PhrasingContent =>
				n.type !== "text" || (n as Text).value.trim().length > 0,
		);
		if (nonEmpty.length === 0) {
			(parent as Parent & { children: unknown[] }).children.splice(position, 1);
			return;
		}

		parentWithChildren.children.splice(position, 1, ...replacementNodes);
	});

	// Render all footnotes (label-based + inline) at the end of the document.
	if (footnoteDefs.size > 0 || inlineFnDefs.length > 0) {
		const footnotesHtml = renderAllFootnotesHtml(footnoteDefs, inlineFnDefs);
		if (footnotesHtml) {
			tree.children.push({ type: "html", value: footnotesHtml });
		}
	}

	if (options.enableTagLinking) {
		unistVisit(tree, "text", (node, position, parent) => {
			if (!parent || typeof position !== "number") {
				return;
			}

			if (SKIP_PARENT_TYPES.has(parent.type)) {
				return;
			}

			const text = node.value;
			if (!text.includes("#")) {
				return;
			}

			const tags = [...text.matchAll(TAG_PATTERN)];
			if (tags.length === 0) {
				return;
			}

			const replacementNodes: PhrasingContent[] = [];
			let cursor = 0;

			for (const tag of tags) {
				const start = tag.index ?? 0;
				const fullMatch = tag[0] ?? "";
				// Trim any trailing slashes that may appear on malformed nested tags.
				const tagName = (tag[1] ?? "").replace(/\/+$/, "");

				if (start > cursor) {
					replacementNodes.push(createTextNode(text.slice(cursor, start)));
				}

				if (tagName && !/^[\p{N}/-]+$/u.test(tagName)) {
					replacementNodes.push(
						createLinkNode(
							`/tags/${encodeTagPathSegment(tagName)}`,
							`#${tagName}`,
						),
					);
				} else {
					replacementNodes.push(createTextNode(fullMatch));
				}
				cursor = start + fullMatch.length;
			}

			if (cursor < text.length) {
				replacementNodes.push(createTextNode(text.slice(cursor)));
			}

			const parentWithChildren = parent as Parent & {
				children: PhrasingContent[];
			};
			parentWithChildren.children.splice(position, 1, ...replacementNodes);
		});
	}

	if (options.enableCallouts) {
		processCallouts(tree);
	}

	if (options.enableMediaEmbeds || options.enableTransclusion) {
		await processEmbedsInTree(
			tree,
			currentPage,
			index,
			options,
			file,
			docsRoot,
			currentFilePath,
			visitedOverride ?? new Set([currentPage.absolutePath]),
			depth,
		);
	}

	resolveWikilinksInAst(tree, currentPage, index, options, file);

	if (includePageDecorations && options.enableBacklinks) {
		const backlinksMap = await getCachedBacklinksIndex(index);
		const refs = backlinksMap.get(currentPage.routePath) ?? [];
		const html = renderBacklinksHtml(refs);
		if (html) {
			tree.children.push({ type: "html", value: html });
		}
	}

	if (includePageDecorations && currentPage.cssclasses.length > 0) {
		const classes = currentPage.cssclasses.map(escapeHtmlAttribute).join(" ");
		tree.children.unshift({
			type: "html",
			value: `<div class="${classes}">`,
		});
		tree.children.push({ type: "html", value: "</div>" });
	}
}

async function renderTranscludedHtml(
	content: string,
	options: NormalizedPluginOptions,
	file: VFile,
	docsRoot: string,
	currentFilePath: string,
	visited: Set<string>,
	depth: number,
): Promise<string> {
	const transcludedAst = unified()
		.use(remarkParse)
		.use(remarkGfm)
		.parse(content) as Root;
	await remarkWikilinkInner(
		transcludedAst,
		file,
		() => docsRoot,
		options,
		currentFilePath,
		false,
		visited,
		depth,
		content,
	);

	const htmlProcessor = unified()
		.use(remarkRehype, { allowDangerousHtml: true })
		.use(rehypeStringify, { allowDangerousHtml: true });
	const hastTree = htmlProcessor.runSync(transcludedAst);
	return htmlProcessor.stringify(hastTree);
}

async function processEmbedsInTree(
	tree: Root,
	currentPage: ContentPage,
	index: ContentIndex,
	options: NormalizedPluginOptions,
	file: VFile,
	docsRoot: string,
	currentFilePath: string,
	visited: Set<string>,
	depth: number,
): Promise<void> {
	const resolveOptions = {
		enableFuzzyMatching: options.enableFuzzyMatching,
		enableCaseInsensitiveLookup: options.enableCaseInsensitiveLookup,
	};

	// Two-pass approach: collect nodes with their positions, then resolve async
	interface EmbedWork {
		node: Text;
		position: number;
		parent: Parent;
	}
	const embedNodes: EmbedWork[] = [];

	unistVisit(tree, "text", (node, position, parent) => {
		if (!parent || typeof position !== "number") return;
		if (SKIP_PARENT_TYPES.has(parent.type)) return;
		if (!node.value.includes("![")) return;
		const embedMatches = [...node.value.matchAll(WIKILINK_EMBED_PATTERN)];
		if (embedMatches.length > 0) {
			embedNodes.push({ node, position, parent });
		}
	});

	// Process all embed nodes with proper async file reads,
	// building AST nodes (text + html) instead of a raw HTML string.
	for (const { node, position, parent } of embedNodes) {
		const text = node.value;
		const embedMatches = [...text.matchAll(WIKILINK_EMBED_PATTERN)];
		if (embedMatches.length === 0) continue;

		const replacementNodes: PhrasingContent[] = [];
		let lastEnd = 0;

		for (const match of embedMatches) {
			const start = match.index ?? 0;
			const fullMatch = match[0];
			const inner = match[1] ?? "";

			if (start > lastEnd) {
				replacementNodes.push(createTextNode(text.slice(lastEnd, start)));
			}

			const parsedEmbed = parseWikiLink(inner, fullMatch);
			const pipeIdx = inner.indexOf("|");
			const sizeParam = pipeIdx >= 0 ? inner.slice(pipeIdx + 1) : "";
			const target = parsedEmbed.target;
			const fragment = parsedEmbed.subpath
				? `#${parsedEmbed.subpath.value}`
				: "";
			const ext = target.split(".").pop()?.toLowerCase() ?? "";
			if (options.enableMediaEmbeds && IMAGE_EXTS.has(ext)) {
				const sizeAttr = parseSizeAttr(sizeParam);
				const resolved = resolveMediaSrc(target, docsRoot, currentFilePath);
				if (!resolved.found) {
					file.message(
						`[rspress-plugin-obsidian-wikilink:media] Image "${target}" not found on disk for ${fullMatch}.`,
					);
				}
				const src = escapeHtmlAttribute(`${resolved.url}${fragment}`);
				replacementNodes.push({
					type: "html",
					value: `<img src="${src}" alt="${escapeHtmlAttribute(target)}"${sizeAttr} loading="lazy" />`,
				});
			} else if (options.enableMediaEmbeds && AUDIO_EXTS.has(ext)) {
				const resolved = resolveMediaSrc(target, docsRoot, currentFilePath);
				if (!resolved.found) {
					file.message(
						`[rspress-plugin-obsidian-wikilink:media] Audio "${target}" not found on disk for ${fullMatch}.`,
					);
				}
				const src = escapeHtmlAttribute(`${resolved.url}${fragment}`);
				replacementNodes.push({
					type: "html",
					value: `<audio controls src="${src}"></audio>`,
				});
			} else if (options.enableMediaEmbeds && VIDEO_EXTS.has(ext)) {
				const sizeAttr = parseSizeAttr(sizeParam);
				const resolved = resolveMediaSrc(target, docsRoot, currentFilePath);
				if (!resolved.found) {
					file.message(
						`[rspress-plugin-obsidian-wikilink:media] Video "${target}" not found on disk for ${fullMatch}.`,
					);
				}
				const src = escapeHtmlAttribute(`${resolved.url}${fragment}`);
				replacementNodes.push({
					type: "html",
					value: `<video controls src="${src}"${sizeAttr}></video>`,
				});
			} else if (options.enableMediaEmbeds && ext === PDF_EXT) {
				const resolved = resolveMediaSrc(target, docsRoot, currentFilePath);
				if (!resolved.found) {
					file.message(
						`[rspress-plugin-obsidian-wikilink:media] PDF "${target}" not found on disk for ${fullMatch}.`,
					);
				}
				const src = escapeHtmlAttribute(`${resolved.url}${fragment}`);
				const pdfHeight =
					parsedEmbed.subpath?.value.match(/^height=(\d+)$/i)?.[1] ?? "600";
				replacementNodes.push({
					type: "html",
					value: `<iframe src="${src}" width="100%" height="${pdfHeight}px" frameborder="0"></iframe>`,
				});
			} else if (options.enableTransclusion) {
				const resolved = resolveWikiLink(parsedEmbed, {
					currentPage,
					index,
					options: resolveOptions,
				});

				if (resolved.status === "ok" && resolved.targetPage) {
					if (visited.has(resolved.targetPage.absolutePath)) {
						file.message(
							`[rspress-plugin-obsidian-wikilink:transclusion] Circular transclusion detected: ${fullMatch} in "${currentPage.relativePath}".`,
						);
						replacementNodes.push(createTextNode(fullMatch));
					} else if (depth >= MAX_TRANSCLUSION_DEPTH) {
						file.message(
							`[rspress-plugin-obsidian-wikilink:transclusion] Max transclusion depth (${MAX_TRANSCLUSION_DEPTH}) reached for ${fullMatch} in "${currentPage.relativePath}".`,
						);
						replacementNodes.push(createTextNode(fullMatch));
					} else {
						try {
							const content = await fs.promises.readFile(
								resolved.targetPage.absolutePath,
								"utf-8",
							);
							const parsed = parsedEmbed;
							let transcludedContent: string | undefined;

							if (parsed.subpath) {
								if (parsed.subpath.kind === "heading") {
									transcludedContent = extractHeadingSection(
										content,
										parsed.subpath.value,
									);
								} else if (parsed.subpath.kind === "block") {
									transcludedContent = extractBlockSection(
										content,
										parsed.subpath.value,
									);
								}

								if (transcludedContent === undefined) {
									const suffix =
										parsed.subpath.kind === "heading"
											? formatAvailableHeadings(resolved.targetPage)
											: formatAvailableBlocks(resolved.targetPage);
									file.message(
										`[rspress-plugin-obsidian-wikilink:transclusion] ${parsed.subpath.kind === "heading" ? "Heading" : "Block"} "${parsed.subpath.value}" not found in "${resolved.targetPage.relativePath}" for ${fullMatch};${suffix} falling back to full page content.`,
									);
								}
							}

							if (transcludedContent === undefined) {
								transcludedContent = stripFrontmatter(content);
							}

							const transcludedHtml = await renderTranscludedHtml(
								transcludedContent,
								options,
								file,
								docsRoot,
								resolved.targetPage.absolutePath,
								new Set([...visited, resolved.targetPage.absolutePath]),
								depth + 1,
							);

							replacementNodes.push({
								type: "html",
								value: `<div class="obsidian-transclusion" data-src="${escapeHtmlAttribute(resolved.href ?? "")}">\n${transcludedHtml}\n</div>`,
							});
						} catch (error) {
							file.message(
								`[rspress-plugin-obsidian-wikilink:transclusion] Failed to read "${resolved.targetPage.relativePath}" for ${fullMatch}: ${error instanceof Error ? error.message : String(error)}`,
							);
							replacementNodes.push(createTextNode(fullMatch));
						}
					}
				} else {
					replacementNodes.push(createTextNode(fullMatch));
				}
			} else {
				replacementNodes.push(createTextNode(fullMatch));
			}

			lastEnd = start + fullMatch.length;
		}

		if (lastEnd < text.length) {
			replacementNodes.push(createTextNode(text.slice(lastEnd)));
		}

		// Splice the replacement AST nodes in place of the original text node.
		// Using html-type nodes instead of embedding HTML in a text node fixes
		// the escaping bug where transcluded content appeared as escaped HTML.
		const parentWithChildren = parent as Parent & {
			children: PhrasingContent[];
		};
		parentWithChildren.children.splice(position, 1, ...replacementNodes);
	}
}

function getCurrentFilePath(file: VFile): string | undefined {
	const pathFromFile =
		typeof file.path === "string" ? file.path : file.history.at(-1);
	return pathFromFile ? normalizeFsPath(pathFromFile) : undefined;
}

function createTextNode(value: string): Text {
	return {
		type: "text",
		value,
	};
}

function createLinkNode(url: string, label: string, title?: string): Link {
	return {
		type: "link",
		url,
		...(title ? { title } : {}),
		children: [
			{
				type: "text",
				value: label,
			},
		],
	};
}

function createEmbedNode(url: string, label: string): HTML {
	return {
		type: "html",
		value: `<a class="obsidian-embed" data-obsidian-embed="true" href="${escapeHtmlAttribute(url)}">${escapeHtmlText(label)}</a>`,
	};
}

function createHighlightNode(text: string): HTML {
	return {
		type: "html",
		value: `<mark>${escapeHtmlText(text)}</mark>`,
	};
}

function escapeHtmlText(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value: string): string {
	return escapeHtmlText(value).replace(/"/g, "&quot;");
}

function reportDiagnostic(
	file: VFile,
	raw: string,
	message: string,
	status: "broken-page" | "broken-anchor" | "ambiguous-page",
	options: NormalizedPluginOptions,
): void {
	const prefix = `[rspress-plugin-obsidian-wikilink:${status}] ${raw} — ${message}`;

	if (status === "ambiguous-page") {
		if (options.onAmbiguousLink === "error") {
			file.fail(prefix);
			return;
		}

		file.message(prefix);
		return;
	}

	if (options.onBrokenLink === "error") {
		file.fail(prefix);
		return;
	}

	file.message(prefix);
}

function parseSizeAttr(sizeParam: string): string {
	if (!sizeParam) return "";
	const match = sizeParam.match(/^(\d+)(?:x(\d+))?$/);
	if (!match) return "";
	const width = match[1];
	const height = match[2];
	return height ? ` width="${width}" height="${height}"` : ` width="${width}"`;
}

/**
 * Resolve a media embed target to a root-relative URL.
 * Tries the file relative to the current markdown file, then relative to
 * docsRoot. Falls back to a root-relative path if neither is found on disk.
 */
interface MediaResolveResult {
	url: string;
	found: boolean;
}

function resolveMediaSrc(
	target: string,
	docsRoot: string,
	currentFilePath: string,
): MediaResolveResult {
	const tryRelToFile = path.resolve(path.dirname(currentFilePath), target);
	if (fs.existsSync(tryRelToFile)) {
		const rel = path.relative(docsRoot, tryRelToFile).replace(/\\/g, "/");
		if (!rel.startsWith("..")) {
			return { url: `/${rel}`, found: true };
		}
	}

	const tryRelToRoot = path.resolve(docsRoot, target);
	if (fs.existsSync(tryRelToRoot)) {
		return {
			url: `/${path.relative(docsRoot, tryRelToRoot).replace(/\\/g, "/")}`,
			found: true,
		};
	}

	return {
		url: target.startsWith("/") ? target : `/${target}`,
		found: false,
	};
}

/**
 * Find and process all callout blockquotes in the tree, processing
 * innermost callouts first so that nested callouts are fully resolved
 * before their parent is transformed.
 *
 * Standard unist-util-visit is pre-order (parents before children), which
 * breaks nesting because replacing the outer blockquote removes the inner
 * one from the traversal. This two-phase approach (collect first, then
 * process in reverse) ensures correct nesting order.
 */
function processCallouts(tree: Root): void {
	interface CalloutEntry {
		bq: Blockquote;
		position: number;
		parent: Parent & { children: Root["children"] };
	}

	const stack: CalloutEntry[] = [];

	unistVisit(tree, "blockquote", (node, position, parent) => {
		if (!parent || typeof position !== "number") return;

		const bq = node as Blockquote;
		const firstPara = bq.children[0];
		if (!firstPara || firstPara.type !== "paragraph") return;

		const firstText = firstPara.children.find(
			(c): c is Text => c.type === "text",
		);
		if (!firstText) return;

		const lines = firstText.value.split("\n");
		const headerLine = lines[0] ?? "";
		if (!CALLOUT_HEADER_PATTERN.exec(headerLine)) return;

		stack.push({
			bq,
			position,
			parent: parent as Parent & { children: Root["children"] },
		});
	});

	// Process innermost callouts first so nested ones are resolved before
	// their parent is transformed. post-order ensures child blockquotes are
	// still present in the parent's children when we process the parent.
	for (const { bq, position, parent: parentNode } of stack.reverse()) {
		const firstPara = bq.children[0];
		if (!firstPara || firstPara.type !== "paragraph") continue;

		const firstText = firstPara.children.find(
			(c): c is Text => c.type === "text",
		);
		if (!firstText) continue;

		const lines = firstText.value.split("\n");
		const headerLine = lines[0] ?? "";
		const calloutMatch = CALLOUT_HEADER_PATTERN.exec(headerLine);
		if (!calloutMatch) continue;

		const rawType = calloutMatch[1]?.toLowerCase() ?? "note";
		const calloutType = CALLOUT_TYPE_ALIASES[rawType] ?? rawType;
		const foldState = calloutMatch[2];
		const calloutTitle = calloutMatch[3]?.trim() || rawType;

		const remainingLines = lines.slice(1);
		if (remainingLines.length === 0) {
			bq.children.shift();
		} else {
			firstText.value = remainingLines.join("\n");
		}

		const replacements: Root["children"] = buildCalloutNodes(
			calloutType,
			calloutTitle,
			foldState,
			bq.children as Root["children"],
		);
		parentNode.children.splice(position, 1, ...replacements);
	}
}

/**
 * Build the replacement AST nodes for an Obsidian callout.
 * Foldable callouts (+ expanded, - collapsed) use <details>/<summary>.
 * Static callouts use <div> elements.
 */
function buildCalloutNodes(
	calloutType: string,
	calloutTitle: string,
	foldState: string | undefined,
	contentChildren: Root["children"],
): Root["children"] {
	const escapedType = escapeHtmlAttribute(calloutType);
	const escapedTitle = escapeHtmlText(calloutTitle);

	if (foldState) {
		const openAttr = foldState === "+" ? " open" : "";
		const openTag: HTML = {
			type: "html",
			value: `<details class="callout callout-${escapedType}" data-callout="${escapedType}"${openAttr}>`,
		};
		const summaryTag: HTML = {
			type: "html",
			value: `<summary class="callout-title">${escapedTitle}</summary>`,
		};
		if (contentChildren.length > 0) {
			return [
				openTag,
				summaryTag,
				{ type: "html", value: '<div class="callout-content">' },
				...contentChildren,
				{ type: "html", value: "</div></details>" },
			];
		}

		return [
			openTag,
			summaryTag,
			{ type: "html", value: '<div class="callout-content"></div></details>' },
		];
	}

	const openDiv: HTML = {
		type: "html",
		value: `<div class="callout callout-${escapedType}" data-callout="${escapedType}">`,
	};
	const titleDiv: HTML = {
		type: "html",
		value: `<div class="callout-title">${escapedTitle}</div>`,
	};
	if (contentChildren.length > 0) {
		return [
			openDiv,
			titleDiv,
			{ type: "html", value: '<div class="callout-content">' },
			...contentChildren,
			{ type: "html", value: "</div></div>" },
		];
	}

	return [
		openDiv,
		titleDiv,
		{ type: "html", value: '<div class="callout-content"></div></div>' },
	];
}

function stripFrontmatter(content: string): string {
	if (!content.startsWith("---")) return content;
	const end = content.indexOf("\n---", 3);
	if (end === -1) return content;
	return content.slice(end + 4).trimStart();
}

function extractHeadingSection(
	content: string,
	heading: string,
): string | undefined {
	const stripped = stripFrontmatter(content);
	const lines = stripped.split("\n");
	const normalizedTarget =
		heading
			.split("#")
			.map((part) => part.trim().toLowerCase())
			.filter(Boolean)
			.at(-1) ?? heading.trim().toLowerCase();
	let startLine = -1;
	let startLevel = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";

		// ATX heading: ## Heading text
		const atxMatch = line.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?$/);
		if (atxMatch) {
			const level = (atxMatch[1] ?? "").length;
			const title = (atxMatch[2] ?? "").trim().toLowerCase();
			if (startLine === -1) {
				if (title === normalizedTarget) {
					startLine = i;
					startLevel = level;
				}
			} else if (level <= startLevel) {
				return lines.slice(startLine, i).join("\n").trim();
			}
			continue;
		}

		// Setext heading: text on line i, underline (=== or ---) on line i+1
		const nextLine = lines[i + 1] ?? "";
		const setextUnderline = nextLine.match(/^\s*(=+|-+)\s*$/);
		if (setextUnderline && line.trim().length > 0) {
			const level = (setextUnderline[1] ?? "").startsWith("=") ? 1 : 2;
			const title = line.trim().toLowerCase();
			if (startLine === -1) {
				if (title === normalizedTarget) {
					startLine = i;
					startLevel = level;
				}
			} else if (level <= startLevel) {
				return lines.slice(startLine, i).join("\n").trim();
			}
			i += 1; // skip underline
		}
	}

	if (startLine !== -1) {
		return lines.slice(startLine).join("\n").trim();
	}

	return undefined;
}

function extractBlockSection(
	content: string,
	blockId: string,
): string | undefined {
	const stripped = stripFrontmatter(content);
	const lines = stripped.split("\n");
	const normalizedId = blockId.trim().toLowerCase();

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const lineNorm = line.trim().toLowerCase();

		if (lineNorm === `^${normalizedId}`) {
			let start = i - 1;
			while (start >= 0 && (lines[start] ?? "").trim() !== "") {
				start -= 1;
			}
			const block = lines
				.slice(start + 1, i)
				.join("\n")
				.trim();
			return block || undefined;
		}

		if (line.toLowerCase().includes(`^${normalizedId}`)) {
			return line.replace(/\s*\^[\w-]+\s*$/, "").trim();
		}
	}

	return undefined;
}
function extractFootnoteSourceMetadata(source: string): {
	definitions: Map<string, string>;
	continuationLineNumbers: Set<number>;
} {
	const definitions = new Map<string, string>();
	const continuationLineNumbers = new Set<number>();

	for (const match of source.matchAll(FOOTNOTE_DEF_PATTERN)) {
		const label = match[1] ?? "";
		const content = normalizeFootnoteContent(match[2] ?? "");
		if (!label || !content) continue;

		definitions.set(label, content);
		const startLine = source.slice(0, match.index ?? 0).split(/\r?\n/).length;
		const lines = (match[0] ?? "").split(/\r?\n/);
		for (let offset = 1; offset < lines.length; offset += 1) {
			continuationLineNumbers.add(startLine + offset);
		}
	}

	return { definitions, continuationLineNumbers };
}

function normalizeFootnoteContent(content: string): string {
	return content.replace(/\n[ \t]+/g, " ").trim();
}

function renderAllFootnotesHtml(
	defs: Map<string, string>,
	inlineDefs: Array<{ id: string; content: string }>,
): string {
	const items: string[] = [];

	defs.forEach((content, label) => {
		items.push(
			`<li id="fn-${escapeHtmlAttribute(label)}">${escapeHtmlText(content)} <a href="#fnref-${escapeHtmlAttribute(label)}">↩</a></li>`,
		);
	});

	for (const { id, content } of inlineDefs) {
		items.push(
			`<li id="fn-${escapeHtmlAttribute(id)}">${escapeHtmlText(content)} <a href="#fnref-${escapeHtmlAttribute(id)}">↩</a></li>`,
		);
	}

	if (items.length === 0) return "";

	return `<hr />
<ol class="footnotes">
${items.join("\n")}
</ol>`;
}
