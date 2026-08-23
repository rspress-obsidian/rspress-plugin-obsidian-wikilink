import fs from "node:fs";
import path from "node:path";
import { rehypeHeaderAnchor } from "@rspress/core/dist/node/mdx/rehypePlugins/headerAnchor.js";
import type {
	Blockquote,
	HTML,
	Image,
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
import {
	expandDailyTemplateText,
	parseDailyNoteDate,
	renderDailyNavigation,
} from "./daily-notes.ts";
import { renderDataviewInline, renderDataviewQuery } from "./dataview.ts";
import { renderDataviewJs } from "./dataview-js.ts";
import { findWikilinkMatches, parseWikiLink } from "./parse-wikilink.ts";
import { resolveHeadingSlug, resolveWikiLink } from "./resolve-wikilink.ts";
import { humanizeBaseName, slugifyHeading } from "./slug.ts";
import { encodeTagPathSegment } from "./tag-pages.ts";
import type {
	ContentIndex,
	ContentPage,
	NormalizedPluginOptions,
	ParsedWikiLink,
	RemarkWikiLinkPluginOptions,
	ResolvedWikiLink,
} from "./types.ts";
import {
	formatAvailableBlocks,
	formatAvailableHeadings,
	normalizeFilePathKey,
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

const MAX_TRANSCLUSION_DEPTH = 5;

// Files that produced an "error"-mode diagnostic (broken/ambiguous link).
// Failure is deferred to the end of the top-level pass so one bad link does
// not abort resolution of the remaining wikilinks in the document.
const pendingFailures = new WeakSet<VFile>();

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

function processDataviewNodes(
	tree: Root,
	currentPage: ContentPage,
	index: ContentIndex,
	file: VFile,
	options: NormalizedPluginOptions,
): void {
	unistVisit(tree, "code", (node) => {
		const language = node.lang?.toLowerCase();
		if (language === "dataviewjs") {
			const result = renderDataviewJs(
				node.value,
				currentPage,
				index,
				options.dailyNotes,
			);
			if (result.error) {
				reportDataviewDiagnostic(file, options, result.error);
				return;
			}
			if (!result.html) return;
			const htmlNode = node as unknown as HTML;
			htmlNode.type = "html";
			htmlNode.value = result.html;
			return;
		}
		if (language !== "dataview") return;

		const result = renderDataviewQuery(
			node.value,
			currentPage,
			index,
			options.dailyNotes,
		);
		if (result.error) {
			reportDataviewDiagnostic(file, options, result.error);
			return;
		}
		if (!result.html) return;
		const htmlNode = node as unknown as HTML;
		htmlNode.type = "html";
		htmlNode.value = result.html;
	});

	unistVisit(tree, "text", (node, position, parent) => {
		if (!parent || typeof position !== "number") return;
		if (SKIP_PARENT_TYPES.has(parent.type)) return;
		const visibleFields = node.value.replace(
			/(?:\(|\[)([^()[\]:]+?)::\s*([^\])\n]*?)(?:\)|\])/g,
			(fullMatch, _key: string, value: string, offset: number) =>
				isInsideWikilink(node.value, offset) ? fullMatch : value,
		);
		if (visibleFields !== node.value) node.value = visibleFields;
		if (!node.value.includes("=")) return;
		const matches = [
			...node.value.matchAll(
				/(^|[\s(])=\s*([A-Za-z_][A-Za-z0-9_.]*(?:\([^()\n]*\))?)/g,
			),
		].filter((match) => !isInsideWikilink(node.value, match.index ?? 0));
		if (matches.length === 0) return;

		const replacementNodes: PhrasingContent[] = [];
		let cursor = 0;
		for (const match of matches) {
			const expressionStart = (match.index ?? 0) + (match[1]?.length ?? 0);
			const expression = match[2] ?? "";
			const fullStart = match.index ?? 0;
			if (fullStart > cursor) {
				replacementNodes.push(
					createTextNode(node.value.slice(cursor, expressionStart)),
				);
			}
			const result = renderDataviewInline(
				expression,
				currentPage,
				index,
				options.dailyNotes,
			);
			if (result.error || !result.html) {
				reportDataviewDiagnostic(
					file,
					options,
					result.error ?? "Inline expression returned no value.",
				);
				replacementNodes.push(
					createTextNode(
						node.value.slice(fullStart, expressionStart + expression.length),
					),
				);
			} else {
				replacementNodes.push({ type: "html", value: result.html });
			}
			cursor = expressionStart + expression.length;
		}
		if (cursor < node.value.length) {
			replacementNodes.push(createTextNode(node.value.slice(cursor)));
		}
		(parent as Parent & { children: PhrasingContent[] }).children.splice(
			position,
			1,
			...replacementNodes,
		);
	});
}

function processDailyNoteNodes(
	tree: Root,
	currentPage: ContentPage,
	index: ContentIndex,
	options: NormalizedPluginOptions,
	includePageDecorations: boolean,
): void {
	const date = parseDailyNoteDate(currentPage.relativePath, options.dailyNotes);
	if (!date) return;

	unistVisit(tree, "text", (node, position, parent) => {
		if (!parent || typeof position !== "number") return;
		if (SKIP_PARENT_TYPES.has(parent.type)) return;
		node.value = expandDailyTemplateText(node.value, date);
	});

	if (includePageDecorations && options.dailyNotes.navigation) {
		const navigation = renderDailyNavigation(
			currentPage,
			index.pages,
			options.dailyNotes,
		);
		if (navigation) {
			tree.children.unshift({ type: "html", value: navigation });
		}
	}
}

function reportDataviewDiagnostic(
	file: VFile,
	options: NormalizedPluginOptions,
	message: string,
): void {
	const fullMessage = `[rspress-plugin-obsidian-wikilink:dataview] ${message}`;
	if (options.onDataviewError === "error") {
		file.fail(fullMessage);
		return;
	}
	file.message(fullMessage);
}
export const remarkWikilink: RemarkPluginFactory<RemarkWikiLinkPluginOptions> =
	({ getDocsRoot, options }) =>
	async (tree: Root, file: VFile): Promise<void> => {
		try {
			await remarkWikilinkInner(tree, file, getDocsRoot, options);
		} catch (error) {
			// A fatal VFileMessage (raised by file.fail for error-mode broken or
			// ambiguous links) must propagate so the build actually fails.
			if (
				typeof error === "object" &&
				error !== null &&
				"fatal" in error &&
				(error as { fatal?: unknown }).fatal === true
			) {
				throw error;
			}

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
	if (options.enableDailyNotes) {
		processDailyNoteNodes(
			tree,
			currentPage,
			index,
			options,
			includePageDecorations,
		);
	}

	if (options.enableDataview) {
		processDataviewNodes(tree, currentPage, index, file, options);
	}
	const footnoteSourceMetadata = extractFootnoteSourceMetadata(
		sourceContent ?? String(file),
	);
	const source = sourceContent ?? String(file);

	// Callouts run before every text-level transform: their content paragraphs
	// are rebuilt from raw source (so markdown titles split the AST without
	// truncating it), and the passes below then apply to the rebuilt nodes
	// exactly as they do to the rest of the document. First, any callouts
	// already claimed by Rspress's built-in alert transform are restored from
	// source so they get full Obsidian semantics here too.
	if (options.enableCallouts) {
		restoreHijackedCallouts(tree, source);
		processCallouts(tree, currentPage, index, options, source);
	}

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

		const matches = [...text.matchAll(HIGHLIGHT_PATTERN)].filter(
			(match) => !isInsideWikilink(text, match.index ?? 0),
		);
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

			const tags = [...text.matchAll(TAG_PATTERN)].filter(
				(match) => !isInsideWikilink(text, match.index ?? 0),
			);
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

	if (options.enableMarkdownLinks) {
		await processMarkdownEmbeds(
			tree,
			currentPage,
			index,
			options,
			file,
			docsRoot,
			visitedOverride ?? new Set([currentPage.absolutePath]),
			depth,
		);
	}

	resolveWikilinksInAst(tree, currentPage, index, options, file);
	if (options.enableMarkdownLinks) {
		processMarkdownLinks(tree, currentPage, index, options, file);
	}
	emitBlockAnchors(tree, currentPage);

	// Final cleanup: drop paragraphs emptied by earlier transforms (comments,
	// footnote definitions) and unwrap paragraphs that now contain only raw
	// block-level HTML nodes (embeds, block anchors). Both would otherwise
	// serialize with stray empty <p> wrappers around block-level HTML.
	unistVisit(tree, "paragraph", (node, position, parent) => {
		if (!parent || typeof position !== "number") return;
		if (
			node.children.length === 0 ||
			node.children.every((child) => child.type === "html")
		) {
			(parent as Parent & { children: unknown[] }).children.splice(
				position,
				1,
				...node.children,
			);
		}
	});

	// Only the top-level pass (depth 0) may fail the file: a broken link must
	// not abort resolution of the remaining wikilinks, so failure is raised
	// once the whole document has been processed.
	if (depth === 0 && pendingFailures.has(file)) {
		file.fail(
			`[rspress-plugin-obsidian-wikilink] One or more wikilinks failed to resolve (see messages above).`,
		);
	}
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
		.use(rehypeHeaderAnchor)
		.use(rehypeStringify, { allowDangerousHtml: true });
	const hastTree = htmlProcessor.runSync(transcludedAst);
	return htmlProcessor.stringify(hastTree);
}

interface PageEmbedContext {
	options: NormalizedPluginOptions;
	file: VFile;
	docsRoot: string;
	currentPage: ContentPage;
	visited: Set<string>;
	depth: number;
}

/**
 * Render a resolved page embed — `![[Page]]`, `![[Page#Section]]`, or the
 * markdown form `![alt](Page.md)` — as a transclusion node shared by both
 * embed syntaxes.
 *
 * A missing heading or block section renders as an embed link to the page,
 * matching Obsidian, which shows unresolved embeds as links rather than
 * inlining the entire page.
 */
async function renderPageEmbed(
	parsedEmbed: ParsedWikiLink,
	resolved: ResolvedWikiLink,
	ctx: PageEmbedContext,
): Promise<PhrasingContent> {
	const { targetPage } = resolved;
	if (!targetPage) {
		return createTextNode(parsedEmbed.raw);
	}

	if (ctx.visited.has(targetPage.absolutePath)) {
		ctx.file.message(
			`[rspress-plugin-obsidian-wikilink:transclusion] Circular transclusion detected: ${parsedEmbed.raw} in "${ctx.currentPage.relativePath}".`,
		);
		return createTextNode(parsedEmbed.raw);
	}
	if (ctx.depth >= MAX_TRANSCLUSION_DEPTH) {
		ctx.file.message(
			`[rspress-plugin-obsidian-wikilink:transclusion] Max transclusion depth (${MAX_TRANSCLUSION_DEPTH}) reached for ${parsedEmbed.raw} in "${ctx.currentPage.relativePath}".`,
		);
		return createTextNode(parsedEmbed.raw);
	}

	try {
		const content = await fs.promises.readFile(
			targetPage.absolutePath,
			"utf-8",
		);
		let transcludedContent: string | undefined;

		if (parsedEmbed.subpath) {
			if (parsedEmbed.subpath.kind === "heading") {
				const headingSlug = resolveHeadingSlug(
					targetPage,
					parsedEmbed.subpath.value,
				);
				if (headingSlug !== undefined) {
					transcludedContent = extractHeadingSection(content, headingSlug);
				}
			} else if (parsedEmbed.subpath.kind === "block") {
				transcludedContent = extractBlockSection(
					content,
					parsedEmbed.subpath.value,
				);
			}

			if (transcludedContent === undefined) {
				const suffix =
					parsedEmbed.subpath.kind === "heading"
						? formatAvailableHeadings(targetPage)
						: formatAvailableBlocks(targetPage);
				ctx.file.message(
					`[rspress-plugin-obsidian-wikilink:transclusion] ${parsedEmbed.subpath.kind === "heading" ? "Heading" : "Block"} "${parsedEmbed.subpath.value}" not found in "${targetPage.relativePath}" for ${parsedEmbed.raw};${suffix} rendering as a link to the page.`,
				);
				return createEmbedNode(
					targetPage.routePath,
					parsedEmbed.alias ?? humanizeBaseName(targetPage.baseName),
				);
			}
		}

		if (transcludedContent === undefined) {
			transcludedContent = stripFrontmatter(content);
		}

		const transcludedHtml = await renderTranscludedHtml(
			transcludedContent,
			ctx.options,
			ctx.file,
			ctx.docsRoot,
			targetPage.absolutePath,
			new Set([...ctx.visited, targetPage.absolutePath]),
			ctx.depth + 1,
		);

		return {
			type: "html",
			value: `<div class="obsidian-transclusion" data-src="${escapeHtmlAttribute(resolved.href ?? "")}">\n${transcludedHtml}\n</div>`,
		};
	} catch (error) {
		ctx.file.message(
			`[rspress-plugin-obsidian-wikilink:transclusion] Failed to read "${targetPage.relativePath}" for ${parsedEmbed.raw}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return createTextNode(parsedEmbed.raw);
	}
}

function isExternalUrl(url: string): boolean {
	return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//");
}

/**
 * Build a {@link ParsedWikiLink} from a standard markdown link destination.
 *
 * Only `.md` / `.mdx` file references are considered — Obsidian's
 * autocomplete emits that form, and anything else (external URLs, pure
 * `#anchors`, extensionless routes) belongs to Rspress's own link handling.
 * Percent-encoded destinations are decoded before resolution.
 */
function parseMarkdownLinkUrl(
	url: string,
	raw: string,
	isEmbed: boolean,
): ParsedWikiLink | undefined {
	if (!url || isExternalUrl(url) || url.startsWith("#")) {
		return undefined;
	}

	let decoded = url;
	try {
		decoded = decodeURIComponent(url);
	} catch {
		// keep the raw form when the destination is not valid percent-encoding
	}

	const hashIndex = decoded.indexOf("#");
	const pathPart = (
		hashIndex >= 0 ? decoded.slice(0, hashIndex) : decoded
	).trim();
	if (!/\.(md|mdx)$/i.test(pathPart)) {
		return undefined;
	}

	const anchor =
		hashIndex >= 0 ? decoded.slice(hashIndex + 1).trim() : undefined;
	const subpath = anchor
		? anchor.startsWith("^")
			? { kind: "block" as const, value: anchor.slice(1).trim() }
			: { kind: "heading" as const, value: anchor }
		: undefined;

	return {
		raw,
		target: pathPart.replace(/\.(md|mdx)$/i, ""),
		isEmbed,
		subpath,
		isCurrentPageReference: false,
	};
}

/**
 * Rewrite standard markdown links whose destination is a vault page —
 * `[label](Page.md)`, `[label](./relative.md)`, `[label](Page.md#Heading)` —
 * to the resolved route, using the same resolution ladder as wikilinks
 * (path, basename, title/alias, case-insensitive, fuzzy). Unresolvable
 * destinations are reported through `onBrokenLink` — this plugin owns that
 * diagnostic for `.md` links because it disables Rspress's dead-link gate
 * when markdown-link resolution is enabled.
 */
function processMarkdownLinks(
	tree: Root,
	currentPage: ContentPage,
	index: ContentIndex,
	options: NormalizedPluginOptions,
	file: VFile,
): void {
	const resolveOptions = {
		enableFuzzyMatching: options.enableFuzzyMatching,
		enableCaseInsensitiveLookup: options.enableCaseInsensitiveLookup,
	};

	unistVisit(tree, "link", (node: Link) => {
		const parsed = parseMarkdownLinkUrl(node.url, `[…](${node.url})`, false);
		if (!parsed) {
			return;
		}

		const resolved = resolveWikiLink(parsed, {
			currentPage,
			index,
			options: resolveOptions,
		});
		if (resolved.status === "ok") {
			if (resolved.href) {
				node.url = resolved.href;
			}
		} else {
			reportDiagnostic(
				file,
				`[…](${node.url})`,
				resolved.message ?? "Unable to resolve markdown link.",
				resolved.status,
				options,
			);
		}
	});
}

/**
 * Resolve markdown embeds of vault pages — `![alt](note.md)` — the form
 * Obsidian transcludes identically to `![[note]]`. With transclusion
 * enabled the page is inlined; otherwise the embed becomes a styled link,
 * mirroring how non-transcluded `![[Page]]` wikilinks behave.
 */
async function processMarkdownEmbeds(
	tree: Root,
	currentPage: ContentPage,
	index: ContentIndex,
	options: NormalizedPluginOptions,
	file: VFile,
	docsRoot: string,
	visited: Set<string>,
	depth: number,
): Promise<void> {
	const resolveOptions = {
		enableFuzzyMatching: options.enableFuzzyMatching,
		enableCaseInsensitiveLookup: options.enableCaseInsensitiveLookup,
	};

	interface EmbedWork {
		node: Image;
		parent: Parent;
	}
	const work: EmbedWork[] = [];

	unistVisit(tree, "image", (node, _position, parent) => {
		if (!parent) return;
		if (!/\.(md|mdx)([#?]|$)/i.test(node.url)) return;
		work.push({ node: node as Image, parent });
	});

	for (const { node, parent } of work) {
		const raw = `![${node.alt ?? ""}](${node.url})`;
		const parsed = parseMarkdownLinkUrl(node.url, raw, true);
		if (!parsed) continue;

		const resolved = resolveWikiLink(parsed, {
			currentPage,
			index,
			options: resolveOptions,
		});
		if (resolved.status !== "ok" || !resolved.targetPage) {
			if (resolved.status !== "ok") {
				reportDiagnostic(
					file,
					raw,
					resolved.message ?? "Unable to resolve markdown embed.",
					resolved.status,
					options,
				);
			}
			continue;
		}

		const replacement: PhrasingContent = options.enableTransclusion
			? await renderPageEmbed(parsed, resolved, {
					options,
					file,
					docsRoot,
					currentPage,
					visited,
					depth,
				})
			: createEmbedNode(
					resolved.href ?? resolved.targetPage.routePath,
					node.alt ?? humanizeBaseName(resolved.targetPage.baseName),
				);

		const parentWithChildren = parent as Parent & {
			children: PhrasingContent[];
		};
		const currentPosition = parentWithChildren.children.indexOf(node);
		if (currentPosition < 0) continue;
		parentWithChildren.children.splice(currentPosition, 1, replacement);
	}
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

	// Two-pass approach: collect nodes, then resolve async
	interface EmbedWork {
		node: Text;
		parent: Parent;
	}
	const embedNodes: EmbedWork[] = [];

	unistVisit(tree, "text", (node, _position, parent) => {
		if (!parent) return;
		if (SKIP_PARENT_TYPES.has(parent.type)) return;
		if (!node.value.includes("![")) return;
		const embedMatches = findWikilinkMatches(node.value).filter((match) =>
			match.fullMatch.startsWith("!["),
		);
		if (embedMatches.length > 0) {
			embedNodes.push({ node, parent });
		}
	});

	// Process all embed nodes with proper async file reads,
	// building AST nodes (text + html) instead of a raw HTML string.
	for (const { node, parent } of embedNodes) {
		const text = node.value;
		const embedMatches = findWikilinkMatches(text).filter((match) =>
			match.fullMatch.startsWith("!["),
		);
		if (embedMatches.length === 0) continue;

		const replacementNodes: PhrasingContent[] = [];
		let lastEnd = 0;

		for (const match of embedMatches) {
			const start = match.start;
			const fullMatch = match.fullMatch;
			const inner = match.inner;

			if (start > lastEnd) {
				replacementNodes.push(createTextNode(text.slice(lastEnd, start)));
			}

			const parsedEmbed = parseWikiLink(inner, fullMatch);
			const sizeParam = parsedEmbed.alias ?? "";
			const target = parsedEmbed.target;
			const fragment = parsedEmbed.subpath
				? `#${parsedEmbed.subpath.value}`
				: "";
			const ext = target.split(".").pop()?.toLowerCase() ?? "";
			if (options.enableMediaEmbeds && IMAGE_EXTS.has(ext)) {
				const sizeAttr = parseSizeAttr(sizeParam);
				// Obsidian treats a numeric pipe as a size; any other pipe text
				// is alt/caption text for the image.
				const altText = sizeAttr ? target : sizeParam.trim() || target;
				const resolved = resolveMediaSrc(
					target,
					docsRoot,
					currentFilePath,
					index,
					options.enableCaseInsensitiveLookup,
				);
				if (!resolved.found) {
					file.message(
						`[rspress-plugin-obsidian-wikilink:media] Image "${target}" not found on disk for ${fullMatch}.`,
					);
				}
				const src = escapeHtmlAttribute(`${resolved.url}${fragment}`);
				replacementNodes.push({
					type: "html",
					value: `<img src="${src}" alt="${escapeHtmlAttribute(altText)}"${sizeAttr} loading="lazy" />`,
				});
			} else if (options.enableMediaEmbeds && AUDIO_EXTS.has(ext)) {
				const resolved = resolveMediaSrc(
					target,
					docsRoot,
					currentFilePath,
					index,
					options.enableCaseInsensitiveLookup,
				);
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
				const resolved = resolveMediaSrc(
					target,
					docsRoot,
					currentFilePath,
					index,
					options.enableCaseInsensitiveLookup,
				);
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
				const resolved = resolveMediaSrc(
					target,
					docsRoot,
					currentFilePath,
					index,
					options.enableCaseInsensitiveLookup,
				);
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
					replacementNodes.push(
						await renderPageEmbed(parsedEmbed, resolved, {
							options,
							file,
							docsRoot,
							currentPage,
							visited,
							depth,
						}),
					);
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

		const parentWithChildren = parent as Parent & {
			children: PhrasingContent[];
		};
		const currentPosition = parentWithChildren.children.indexOf(node);
		if (currentPosition < 0) continue;
		parentWithChildren.children.splice(currentPosition, 1, ...replacementNodes);
	}
}

function getCurrentFilePath(file: VFile): string | undefined {
	const pathFromFile =
		typeof file.path === "string" ? file.path : file.history.at(-1);
	return pathFromFile ? normalizeFsPath(pathFromFile) : undefined;
}

/**
 * True when `index` falls inside a `[[...]]` / `![[...]]` span of `text`.
 * Keeps text-level transforms (tags, highlights) from firing inside wikilink
 * targets and aliases, where `#anchor` and `==text==` belong to the link, not
 * the surrounding prose.
 */
function isInsideWikilink(text: string, index: number): boolean {
	for (const match of findWikilinkMatches(text)) {
		if (index >= match.start && index < match.end) {
			return true;
		}
	}
	return false;
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

/**
 * Emit HTML anchors for every block ID indexed on the current page, so that
 * `[[Page#^block-id]]` links actually resolve in the browser.
 *
 * The resolver produces `#^block-id` fragments; this function is the
 * counterpart that materializes an `id="^block-id"` target in the output.
 * Standalone `^id` markers are replaced entirely; inline `… ^id` markers are
 * stripped from the paragraph and replaced with an empty anchor at their
 * position. Both match the exact patterns used by {@link extractBlocks}.
 */
function emitBlockAnchors(tree: Root, currentPage: ContentPage): void {
	const ids = new Set(currentPage.blocks.map((block) => block.id));
	if (ids.size === 0) return;

	unistVisit(tree, "text", (node, position, parent) => {
		if (!parent || typeof position !== "number") return;
		if (SKIP_PARENT_TYPES.has(parent.type)) return;

		const value = node.value;
		if (!value.includes("^")) return;

		const standalone = /^\s*\^([A-Za-z0-9_-]+)\s*$/.exec(value);
		if (standalone) {
			const id = standalone[1];
			if (id && ids.has(id)) {
				(parent as Parent & { children: unknown[] }).children.splice(
					position,
					1,
					createBlockAnchor(id),
				);
			}
			return;
		}

		const inline = /\s\^([A-Za-z0-9_-]+)\s*$/.exec(value);
		if (inline) {
			const id = inline[1];
			if (id && ids.has(id)) {
				const leading = value.slice(0, value.length - inline[0].length);
				const replacement: PhrasingContent[] = [];
				if (leading.length > 0) {
					replacement.push(createTextNode(leading));
				}
				replacement.push(createBlockAnchor(id));
				const children = (parent as Parent & { children: PhrasingContent[] })
					.children;
				children.splice(position, 1, ...replacement);
			}
		}
	});
}

function createBlockAnchor(id: string): HTML {
	return {
		type: "html",
		value: `<a id="^${escapeHtmlAttribute(id)}"></a>`,
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
			pendingFailures.add(file);
			file.message(prefix);
			return;
		}

		file.message(prefix);
		return;
	}

	if (options.onBrokenLink === "error") {
		pendingFailures.add(file);
		file.message(prefix);
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
interface MediaResolveResult {
	url: string;
	found: boolean;
}

/**
 * Resolve a media embed target to a root-relative URL.
 * Tries the file relative to the current markdown file, then relative to
 * docsRoot. Falls back to a root-relative path if neither is found on disk.
 * Each path segment is percent-encoded so spaces and special characters
 * produce valid `src`/`href` URLs.
 */
function resolveMediaSrc(
	target: string,
	docsRoot: string,
	currentFilePath: string,
	index: ContentIndex,
	enableCaseInsensitiveLookup: boolean,
): MediaResolveResult {
	// Percent-encode every segment, dropping `..`/`.` so a wikilink target
	// cannot escape the docs root through the emitted URL.
	const encodePath = (segments: string[]): string =>
		`/${segments
			.filter(
				(segment) => segment !== "" && segment !== "." && segment !== "..",
			)
			.map((segment) => encodeURIComponent(segment))
			.join("/")}`;

	const relativeAsset = (
		absolutePath: string,
	): MediaResolveResult | undefined => {
		const relativePath = path.relative(docsRoot, absolutePath);
		if (
			relativePath.startsWith("..") ||
			path.isAbsolute(relativePath) ||
			relativePath.length === 0
		) {
			return undefined;
		}
		const pathKey = normalizeFilePathKey(normalizeFsPath(relativePath));
		const exact = index.byAssetPath.get(pathKey);
		if (exact) {
			return { url: exact.urlPath, found: true };
		}
		if (!enableCaseInsensitiveLookup) {
			return undefined;
		}
		const candidates = index.byAssetPathCI.get(pathKey.toLowerCase()) ?? [];
		return candidates.length === 1 && candidates[0]
			? { url: candidates[0].urlPath, found: true }
			: undefined;
	};

	const tryRelToFile = path.resolve(path.dirname(currentFilePath), target);
	if (fs.existsSync(tryRelToFile)) {
		const rel = path.relative(docsRoot, tryRelToFile).replace(/\\/g, "/");
		if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
			return { url: encodePath(rel.split("/")), found: true };
		}
	}
	const indexedRelative = relativeAsset(tryRelToFile);
	if (indexedRelative) {
		return indexedRelative;
	}

	const tryRelToRoot = path.resolve(docsRoot, target);
	if (fs.existsSync(tryRelToRoot)) {
		const rel = path.relative(docsRoot, tryRelToRoot).replace(/\\/g, "/");
		if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
			return { url: encodePath(rel.split("/")), found: true };
		}
	}
	const indexedRoot = relativeAsset(tryRelToRoot);
	if (indexedRoot) {
		return indexedRoot;
	}

	// When no path-qualified asset matched, mirror page wikilinks by accepting
	// a unique basename, including nested and case-insensitive attachments.
	const basename = path.basename(normalizeFilePathKey(target));
	const exactBasename = index.byAssetBaseName.get(basename) ?? [];
	if (exactBasename.length === 1 && exactBasename[0]) {
		return { url: exactBasename[0].urlPath, found: true };
	}
	if (enableCaseInsensitiveLookup) {
		const caseInsensitiveBasename =
			index.byAssetBaseNameCI.get(basename.toLowerCase()) ?? [];
		if (caseInsensitiveBasename.length === 1 && caseInsensitiveBasename[0]) {
			return { url: caseInsensitiveBasename[0].urlPath, found: true };
		}
	}

	const fallback = target.startsWith("/") ? target.slice(1) : target;
	return {
		url: encodePath(fallback.split("/")),
		found: false,
	};
}

// The marker Rspress's built-in GitHub-style alert transform (its internal
// remarkContainerSyntax plugin) uses for the containerDirective nodes it
// creates, and the callout types it claims.
const RSPRESS_CALLOUT_COMPONENT = "$$$callout$$$";
const RSPRESS_CALLOUT_TYPES = new Set([
	"tip",
	"note",
	"warning",
	"caution",
	"danger",
	"info",
	"details",
]);

interface RspressCalloutContainer {
	type: "containerDirective";
	name?: string;
	attributes?: { type?: string; title?: string };
	children: Root["children"];
	position?: { start?: { line?: number }; end?: { line?: number } };
}

interface NodeWithLine {
	position?: { start?: { line?: number }; end?: { line?: number } };
	children?: NodeWithLine[];
}

/**
 * Restore blockquote callouts that Rspress's built-in GitHub-style alert
 * transform has already claimed.
 *
 * Rspress registers remarkContainerSyntax before plugin remark plugins, so
 * `> [!note]` blockquotes for note/tip/warning/caution/danger/info/details
 * arrive here already converted to `$$$callout$$$` containerDirective nodes —
 * with the fold suffix leaked into the content and the first paragraph of
 * multi-paragraph alerts dropped entirely.
 *
 * The converted nodes keep their original source positions, so each one can
 * be verified against the raw source: walk up from its first positioned
 * child through the contiguous `>`-prefixed lines and check that the range
 * starts with a `[!type]` header matching the container's type. That
 * distinguishes GitHub-alert origin from `:::type` containers (whose source
 * lines are not `>`-prefixed), which keep Rspress's native rendering.
 * Verified nodes are replaced with the blockquote re-parsed from the
 * original source — recovering the header, fold state, and any dropped
 * content — and are then transformed by {@link processCallouts} like any
 * other callout.
 */
function restoreHijackedCallouts(tree: Root, source: string): void {
	const sourceLines = source.split(/\r?\n/);

	interface Candidate {
		node: RspressCalloutContainer;
		parent: Parent & { children: Root["children"] };
		startLine: number;
		endLine: number;
	}
	const candidates: Candidate[] = [];
	const parents = new WeakMap<object, Parent>();

	// Collect hijacked containers with the source line range they cover.
	// Only the topmost ones are restored: replacing an outer container
	// re-parses its nested callouts from source too.
	unistVisit(tree, "containerDirective", (rawNode, _position, parent) => {
		const node = rawNode as RspressCalloutContainer;
		if (parent) {
			parents.set(node, parent);
		}
		if (
			!parent ||
			node.name !== RSPRESS_CALLOUT_COMPONENT ||
			!node.attributes?.type ||
			!RSPRESS_CALLOUT_TYPES.has(node.attributes.type)
		) {
			return;
		}

		let startLine = Number.POSITIVE_INFINITY;
		let endLine = 0;
		const scan = (current: NodeWithLine): void => {
			const line = current.position?.start?.line;
			const end = current.position?.end?.line;
			if (typeof line === "number" && line < startLine) {
				startLine = line;
			}
			if (typeof end === "number" && end > endLine) {
				endLine = end;
			}
			for (const child of current.children ?? []) {
				scan(child);
			}
		};
		scan(node);
		if (
			!Number.isFinite(startLine) ||
			endLine <= 0 ||
			startLine > sourceLines.length ||
			endLine > sourceLines.length
		) {
			return;
		}

		// Walk up through the contiguous blockquote lines covering the first
		// positioned child.
		let headerIndex = startLine - 1;
		while (
			headerIndex > 0 &&
			(sourceLines[headerIndex - 1] ?? "").trimStart().startsWith(">")
		) {
			headerIndex -= 1;
		}

		const headerLine = (sourceLines[headerIndex] ?? "").replace(
			/^(?:\s*>+)+\s*/,
			"",
		);
		const headerMatch = /^\[!(\w+)\]/.exec(headerLine);
		if (
			!headerMatch ||
			headerMatch[1]?.toLowerCase() !== node.attributes.type
		) {
			return;
		}

		candidates.push({
			node,
			parent: parent as Parent & { children: Root["children"] },
			startLine: headerIndex + 1,
			endLine,
		});
	});

	for (const candidate of candidates) {
		// Skip candidates nested inside another restored container.
		let ancestor = parents.get(candidate.node);
		let nested = false;
		while (ancestor) {
			if (candidates.some((c) => c.node === ancestor)) {
				nested = true;
				break;
			}
			ancestor = parents.get(ancestor);
		}
		if (nested) {
			continue;
		}

		const blockquoteSource = sourceLines
			.slice(candidate.startLine - 1, candidate.endLine)
			.join("\n");
		// Leading blank lines keep the re-parsed positions aligned with the
		// original source lines.
		const fragment = `${"\n".repeat(candidate.startLine - 1)}${blockquoteSource}`;
		const parsed = unified()
			.use(remarkParse)
			.use(remarkGfm)
			.parse(fragment) as Root;
		if (parsed.children.length === 0) {
			continue;
		}

		const index = candidate.parent.children.indexOf(
			candidate.node as unknown as Root["children"][number],
		);
		if (index < 0) {
			continue;
		}
		candidate.parent.children.splice(index, 1, ...parsed.children);
	}
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
 *
 * Header lines are recovered from `source` via node positions rather than
 * from the first text node: inline markdown in a title splits the paragraph
 * into multiple inline nodes, so the text node alone would truncate the
 * title and lose continuation lines.
 */
function processCallouts(
	tree: Root,
	currentPage: ContentPage,
	index: ContentIndex,
	options: NormalizedPluginOptions,
	source: string,
): void {
	interface CalloutEntry {
		bq: Blockquote;
		position: number;
		parent: Parent & { children: Root["children"] };
	}

	const stack: CalloutEntry[] = [];
	const sourceLines = source.split(/\r?\n/);

	// Strip leading blockquote markers (one or more levels) from a source line.
	const stripQuoteMarker = (line: string): string =>
		line.replace(/^(?:\s*>+)+\s*/, "");

	const headerLineOf = (bq: Blockquote): string | undefined => {
		const firstPara = bq.children[0];
		const line = firstPara?.position?.start.line;
		if (typeof line === "number" && line >= 1 && line <= sourceLines.length) {
			return stripQuoteMarker(sourceLines[line - 1] ?? "");
		}

		// Position fallback for synthesized ASTs: use the first text node.
		if (firstPara?.type !== "paragraph") {
			return undefined;
		}
		const firstText = firstPara.children.find(
			(c): c is Text => c.type === "text",
		);
		return firstText?.value.split("\n")[0];
	};

	unistVisit(tree, "blockquote", (node, position, parent) => {
		if (!parent || typeof position !== "number") return;

		const bq = node as Blockquote;
		if (bq.children[0]?.type !== "paragraph") return;

		const headerLine = headerLineOf(bq);
		if (!headerLine || !CALLOUT_HEADER_PATTERN.exec(headerLine)) return;

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
		if (firstPara?.type !== "paragraph") continue;

		const headerLine = headerLineOf(bq);
		const calloutMatch = headerLine
			? CALLOUT_HEADER_PATTERN.exec(headerLine)
			: null;
		if (!calloutMatch) continue;

		const rawType = calloutMatch[1]?.toLowerCase() ?? "note";
		const calloutType = CALLOUT_TYPE_ALIASES[rawType] ?? rawType;
		const foldState = calloutMatch[2];
		const calloutTitle = calloutMatch[3]?.trim() || rawType;

		// Strip the header line from the opening paragraph, keeping any
		// continuation lines as the callout's first content block. The
		// paragraph is rebuilt from source so markdown in the title does not
		// leak into the content (and vice versa).
		const startLine = firstPara.position?.start.line;
		const endLine = firstPara.position?.end.line;
		if (
			typeof startLine === "number" &&
			typeof endLine === "number" &&
			startLine >= 1 &&
			endLine <= sourceLines.length
		) {
			const contentLines = sourceLines
				.slice(startLine, endLine)
				.map(stripQuoteMarker);
			const reParsed = unified().use(remarkParse).parse(contentLines.join("\n"))
				.children as typeof bq.children;
			if (reParsed.length === 0) {
				bq.children.shift();
			} else {
				bq.children.splice(0, 1, ...reParsed);
			}
		} else {
			// Fallback for positionless ASTs: operate on the first text node.
			const firstText = firstPara.children.find(
				(c): c is Text => c.type === "text",
			);
			if (!firstText) continue;
			const remainingLines = firstText.value.split("\n").slice(1);
			if (remainingLines.length === 0) {
				bq.children.shift();
			} else {
				firstText.value = remainingLines.join("\n");
			}
		}

		// Obsidian renders callout titles as inline markdown (and resolves
		// wikilinks in them), so render before escaping into the title element.
		const titleHtml = renderCalloutTitleHtml(
			calloutTitle,
			currentPage,
			index,
			options,
		);

		const replacements: Root["children"] = buildCalloutNodes(
			calloutType,
			titleHtml,
			foldState,
			bq.children as Root["children"],
		);
		parentNode.children.splice(position, 1, ...replacements);
	}
}

/**
 * Build the replacement AST nodes for an Obsidian callout.
 * Foldable callouts (+ expanded, - collapsed) use <details>/<summary>.
 * Static callouts use <div> elements. `titleHtml` must already be
 * renderer-produced HTML (see {@link renderCalloutTitleHtml}), never raw
 * user text.
 */
function buildCalloutNodes(
	calloutType: string,
	titleHtml: string,
	foldState: string | undefined,
	contentChildren: Root["children"],
): Root["children"] {
	const escapedType = escapeHtmlAttribute(calloutType);

	if (foldState) {
		const openAttr = foldState === "+" ? " open" : "";
		const openTag: HTML = {
			type: "html",
			value: `<details class="callout callout-${escapedType}" data-callout="${escapedType}"${openAttr}>`,
		};
		const summaryTag: HTML = {
			type: "html",
			value: `<summary class="callout-title">${titleHtml}</summary>`,
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
		value: `<div class="callout-title">${titleHtml}</div>`,
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

/**
 * Render a callout title — a single line of inline markdown — to HTML.
 *
 * Wikilinks inside the title are resolved first so `[[Page|Alias]]` titles
 * link the way they do in Obsidian. remark-rehype runs without
 * `allowDangerousHtml`, so any raw HTML in the title is dropped and text is
 * entity-escaped by rehype-stringify: the returned markup is safe to embed
 * in the title element.
 */
function renderCalloutTitleHtml(
	title: string,
	currentPage: ContentPage,
	index: ContentIndex,
	options: NormalizedPluginOptions,
): string {
	const withLinks = resolveTitleWikilinks(title, currentPage, index, options);

	// ==highlights== are Obsidian syntax, not markdown, so each highlighted
	// span is rendered separately and wrapped in <mark>. Edge whitespace is
	// re-attached around the rendered cores because inline markdown parsing
	// trims it. Skipped when the title contains a code span, where `==` may
	// be literal text.
	if (withLinks.includes("==") && !withLinks.includes("`")) {
		const parts = withLinks.split(/(==[^=]+==)/).filter(Boolean);
		const highlighted = parts
			.map((part) => {
				const leading = /^[ \t]+/.exec(part)?.[0] ?? "";
				const trailing = /[ \t]+$/.exec(part)?.[0] ?? "";
				const match = /^==([^=]+)==$/.exec(part);
				const core = match?.[1]
					? `<mark>${renderInlineMarkdownHtml(match[1])}</mark>`
					: renderInlineMarkdownHtml(part);
				return `${leading}${core}${trailing}`;
			})
			.join("");
		if (highlighted) {
			return highlighted;
		}
	}

	return renderInlineMarkdownHtml(withLinks) || escapeHtmlText(title);
}

/**
 * Render a single line of inline markdown to HTML. remark-rehype runs
 * without `allowDangerousHtml`, so raw HTML is dropped and text is
 * entity-escaped by rehype-stringify: the result is safe to embed inline.
 */
function renderInlineMarkdownHtml(text: string): string {
	const tree = unified().use(remarkParse).use(remarkGfm).parse(text);
	const processor = unified().use(remarkRehype).use(rehypeStringify);
	const html = processor.stringify(processor.runSync(tree)).trim();

	// A single-line input yields exactly one paragraph; unwrap it so the
	// markup is valid inline content.
	return html
		.replace(/^<p>/, "")
		.replace(/<\/p>\n?$/, "")
		.trim();
}

/**
 * Rewrite every wikilink in a callout title into markdown link syntax so the
 * inline markdown renderer produces a real anchor. Unresolvable wikilinks are
 * left verbatim, matching body-text behaviour.
 */
function resolveTitleWikilinks(
	title: string,
	currentPage: ContentPage,
	index: ContentIndex,
	options: NormalizedPluginOptions,
): string {
	const matches = findWikilinkMatches(title);
	if (matches.length === 0) {
		return title;
	}

	let result = "";
	let cursor = 0;
	for (const match of matches) {
		if (match.start > cursor) {
			result += title.slice(cursor, match.start);
		}

		const parsed = parseWikiLink(match.inner, match.fullMatch);
		const resolved = resolveWikiLink(parsed, {
			currentPage,
			index,
			options: {
				enableFuzzyMatching: options.enableFuzzyMatching,
				enableCaseInsensitiveLookup: options.enableCaseInsensitiveLookup,
			},
		});

		if (resolved.status === "ok" && resolved.href && resolved.label) {
			// Escape bracket characters in the label and markdown-significant
			// characters in the destination so both survive the inline parser.
			const safeLabel = resolved.label.replace(/([[\\]])/g, "\\$1");
			const safeHref = encodeMarkdownDestination(resolved.href);
			result += `[${safeLabel}](${safeHref})`;
		} else {
			result += match.fullMatch;
		}

		cursor = match.end;
	}
	if (cursor < title.length) {
		result += title.slice(cursor);
	}

	return result;
}

/**
 * Percent-encode characters that would terminate a markdown `( destination )`
 * construct, so page routes containing them still parse as one destination.
 */
function encodeMarkdownDestination(href: string): string {
	return href.replace(/[ ()<>\\"[\]]/g, (char) => encodeURIComponent(char));
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
			.map((part) => part.trim())
			.filter(Boolean)
			.at(-1) ?? heading.trim();
	const normalizedLower = normalizedTarget.toLowerCase();
	let startLine = -1;
	let startLevel = 0;

	// True when `line` refers to the requested heading. Accepts a raw heading
	// name, an explicit `{#id}`, or an already-slugified heading anchor.
	const matchesTarget = (line: string): boolean => {
		const trimmed = line.trim();
		const explicitIdMatch = trimmed.match(/\s*\{#([A-Za-z0-9_:.-]+)\}\s*$/);
		const headingText = explicitIdMatch
			? trimmed.slice(0, trimmed.length - explicitIdMatch[0].length).trim()
			: trimmed;
		const slug = slugifyHeading(headingText);
		return (
			normalizedTarget === headingText ||
			normalizedLower === headingText.toLowerCase() ||
			normalizedTarget === slug ||
			normalizedLower === slug ||
			(explicitIdMatch !== null && explicitIdMatch[1] === normalizedTarget)
		);
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";

		// ATX heading: ## Heading text (up to 3 leading spaces, per Markdown)
		const atxMatch = line.match(/^\s{0,3}(#{1,6})[ \t]+(.+?)(?:\s+#+)?[ \t]*$/);
		if (atxMatch) {
			const level = (atxMatch[1] ?? "").length;
			const title = (atxMatch[2] ?? "").trim();
			if (startLine === -1) {
				if (matchesTarget(title)) {
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
			const title = line.trim();
			if (startLine === -1) {
				if (matchesTarget(title)) {
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

		// Standalone block ID on its own line: references the block above it
		// (blank lines between the block and the marker are tolerated).
		if (lineNorm === `^${normalizedId}`) {
			let start = i - 1;
			while (start >= 0 && (lines[start] ?? "").trim() === "") {
				start -= 1;
			}
			while (start >= 0 && (lines[start] ?? "").trim() !== "") {
				start -= 1;
			}
			const block = lines
				.slice(start + 1, i)
				.join("\n")
				.trim();
			return block || undefined;
		}

		// Inline block ID appended to a line: references that whole block.
		const inlineMatch = line.match(/^(.*?)\s+\^([A-Za-z0-9_-]+)\s*$/);
		if (inlineMatch && inlineMatch[2]?.toLowerCase() === normalizedId) {
			const text = (inlineMatch[1] ?? "").trimEnd();
			return extractInlineBlock(lines, i, text) || undefined;
		}
	}

	return undefined;
}

/**
 * Extract the markdown block beginning at `index`, whose first line is `text`
 * (already stripped of the inline block ID). List items are extended to include
 * their nested sub-items and continuation lines; every other block type is
 * returned as a single line, matching the indexed block-ID semantics.
 */
function extractInlineBlock(
	lines: string[],
	index: number,
	text: string,
): string {
	const listItem = text.match(/^(\s*)([-*+]|\d+[.)])\s+/);
	if (!listItem) {
		return text.trim();
	}

	const indent = (listItem[1] ?? "").length;
	const block: string[] = [];
	for (let j = index; j < lines.length; j++) {
		if (j === index) {
			block.push(text);
			continue;
		}

		const line = lines[j] ?? "";
		if (line.trim() === "") {
			block.push(line);
			continue;
		}

		const leading = line.length - line.trimStart().length;
		if (leading > indent) {
			block.push(line);
			continue;
		}

		// A sibling item at the same indent, or a dedented line, ends the block.
		break;
	}

	return block.join("\n").trim();
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
