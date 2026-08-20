import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RspressPlugin } from "@rspress/core";
import type { RemarkPluginFactory } from "rspress-plugin-devkit";
import { buildContentIndex } from "./content-index.ts";
import { normalizeDailyNoteConfig } from "./daily-notes.ts";
import { remarkWikilink } from "./remark-wikilink.ts";
import { generateTagPages } from "./tag-pages.ts";
import type {
	NormalizedPluginOptions,
	RemarkWikiLinkPluginOptions,
	RspressPluginObsidianWikiLinkOptions,
} from "./types.ts";

export type { BacklinkRef } from "./backlinks.ts";
export {
	buildBacklinksIndex,
	getCachedBacklinksIndex,
	renderBacklinksHtml,
} from "./backlinks.ts";
export {
	buildContentIndex,
	getCachedContentIndex,
} from "./content-index.ts";
export {
	expandDailyTemplateText,
	formatDailyNoteDate,
	normalizeDailyNoteConfig,
	parseDailyNoteDate,
	renderDailyNavigation,
} from "./daily-notes.ts";
export {
	extractDataviewMetadata,
	renderDataviewInline,
	renderDataviewQuery,
} from "./dataview.ts";
export { findWikilinkMatches, parseWikiLink } from "./parse-wikilink.ts";
export { resolveWikiLink } from "./resolve-wikilink.ts";
export {
	type AdditionalPage,
	encodeTagPathSegment,
	generateTagPages,
} from "./tag-pages.ts";
export type {
	BlockEntry,
	ContentAsset,
	ContentIndex,
	ContentPage,
	DailyNotesOptions,
	DataviewListItem,
	DataviewTask,
	DiagnosticMode,
	HeadingEntry,
	NormalizedPluginOptions,
	ParsedWikiLink,
	ResolveContext,
	ResolvedWikiLink,
	ResolveStatus,
	RspressPluginObsidianWikiLinkOptions,
	WikilinkMatch,
	WikiSubpath,
} from "./types.ts";

function normalizePluginOptions(
	options: RspressPluginObsidianWikiLinkOptions = {},
): NormalizedPluginOptions {
	return {
		onBrokenLink: options.onBrokenLink ?? "error",
		onAmbiguousLink: options.onAmbiguousLink ?? "error",
		enableFuzzyMatching: options.enableFuzzyMatching ?? false,
		enableCaseInsensitiveLookup: options.enableCaseInsensitiveLookup ?? true,
		enableMarkdownLinks: options.enableMarkdownLinks ?? true,
		onDataviewError: options.onDataviewError ?? "error",
		enableDataview: options.enableDataview ?? false,
		enableDailyNotes: options.enableDailyNotes ?? false,
		dailyNotes: normalizeDailyNoteConfig(options.dailyNotes),
		enableTagLinking: options.enableTagLinking ?? false,
		enableCallouts: options.enableCallouts ?? false,
		enableBacklinks: options.enableBacklinks ?? false,
		enableTransclusion: options.enableTransclusion ?? false,
		enableMediaEmbeds: options.enableMediaEmbeds ?? false,
		enableTagPages: options.enableTagPages ?? false,
		enableDefaultStyles: options.enableDefaultStyles ?? false,
	};
}

// Resolved at module load time — works from both src/ (dev) and dist/ (published).
const STYLES_PATH = fileURLToPath(new URL("./styles.css", import.meta.url));

/**
 * Rspress plugin that rewrites Obsidian-style wikilinks and supporting syntax
 * (callouts, tags, backlinks, transclusion, media embeds, footnotes, highlights,
 * comments, and optional static Dataview DQL) during the remark pipeline.
 *
 * @example
 * ```ts
 * // rspress.config.ts
 * import { defineConfig } from "@rspress/core";
 * import { pluginObsidianWikiLink } from "rspress-plugin-obsidian-wikilink";
 *
 * export default defineConfig({
 *   plugins: [
 *     pluginObsidianWikiLink({
 *       enableCallouts: true,
 *       enableBacklinks: true,
 *       enableDefaultStyles: true,
 *     }),
 *   ],
 * });
 * ```
 *
 * @param options - Feature toggles and diagnostic behaviour. All fields are
 *   optional; see {@link RspressPluginObsidianWikiLinkOptions} for details.
 * @returns An {@link RspressPlugin} ready to append to `plugins:`.
 */
export function pluginObsidianWikiLink(
	options: RspressPluginObsidianWikiLinkOptions = {},
): RspressPlugin {
	const normalizedOptions = normalizePluginOptions(options);
	let docsRoot = path.resolve(process.cwd(), "docs");

	const remarkPluginTuple: [
		RemarkPluginFactory<RemarkWikiLinkPluginOptions>,
		RemarkWikiLinkPluginOptions,
	] = [
		remarkWikilink,
		{
			getDocsRoot: () => docsRoot,
			options: normalizedOptions,
		},
	];

	return {
		name: "rspress-plugin-obsidian-wikilink",

		...(normalizedOptions.enableDefaultStyles && {
			globalStyles: STYLES_PATH,
		}),

		config(config) {
			docsRoot = path.resolve(process.cwd(), config.root ?? "docs");

			// Vault-style markdown links (`[x](Page.md)` resolved by basename,
			// not relative path) fail Rspress's own dead-link gate before this
			// plugin's remark pass can resolve them. When markdown-link
			// resolution is on, take over that gate — unresolved `.md`
			// destinations are then reported through `onBrokenLink` instead,
			// preserving build safety. An explicit user setting wins.
			if (
				normalizedOptions.enableMarkdownLinks &&
				config.markdown?.link?.checkDeadLinks === undefined
			) {
				config.markdown = {
					...config.markdown,
					link: { ...config.markdown?.link, checkDeadLinks: false },
				};
			}

			return config;
		},

		...(normalizedOptions.enableTagPages && {
			async addPages(config) {
				const root = path.resolve(
					process.cwd(),
					(config as { root?: string }).root ?? "docs",
				);
				docsRoot = root;
				const index = await buildContentIndex(root);
				return generateTagPages(index);
			},
		}),

		markdown: {
			remarkPlugins: [remarkPluginTuple],
		},
	};
}
