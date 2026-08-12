import { describe, expect, test } from "bun:test";
import path from "node:path";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { buildContentIndex, getCachedContentIndex } from "../src/content-index";
import { findWikilinkMatches, parseWikiLink } from "../src/parse-wikilink";
import { remarkWikilink } from "../src/remark-wikilink";
import { resolveWikiLink } from "../src/resolve-wikilink";
import type { NormalizedPluginOptions } from "../src/types";

const fixtureRoot = path.resolve(process.cwd(), "tests/fixtures/basic");
const assetsFixtureRoot = path.resolve(process.cwd(), "tests/fixtures/assets");
const strictFixtureRoot = path.resolve(process.cwd(), "tests/fixtures/strict");
const headingFixtureRoot = path.resolve(
	process.cwd(),
	"tests/fixtures/headings",
);
const aliasFixtureRoot = path.resolve(process.cwd(), "tests/fixtures/aliases");
const aliasAmbiguousFixtureRoot = path.resolve(
	process.cwd(),
	"tests/fixtures/alias-ambiguous",
);
const inlineBlocksFixtureRoot = path.resolve(
	process.cwd(),
	"tests/fixtures/inline-blocks",
);
const tagsFixtureRoot = path.resolve(process.cwd(), "tests/fixtures/tags");
const setextFixtureRoot = path.resolve(process.cwd(), "tests/fixtures/setext");
const cssclassesFixtureRoot = path.resolve(
	process.cwd(),
	"tests/fixtures/cssclasses",
);
const nestedTagsFixtureRoot = path.resolve(
	process.cwd(),
	"tests/fixtures/nested-tags",
);
const publishFixtureRoot = path.resolve(
	process.cwd(),
	"tests/fixtures/publish",
);
const complexYamlFixtureRoot = path.resolve(
	process.cwd(),
	"tests/fixtures/complex-yaml",
);
const recursiveTransclusionFixtureRoot = path.resolve(
	process.cwd(),
	"tests/fixtures/recursive-transclusion",
);
const circularTransclusionFixtureRoot = path.resolve(
	process.cwd(),
	"tests/fixtures/circular-transclusion",
);
const deepTransclusionFixtureRoot = path.resolve(
	process.cwd(),
	"tests/fixtures/deep-transclusion",
);
const transclusionFeaturesFixtureRoot = path.resolve(
	process.cwd(),
	"tests/fixtures/transclusion-features",
);

const compatibilityFixtureRoot = path.resolve(
	process.cwd(),
	"tests/fixtures/compatibility",
);

const DEFAULT_OPTIONS: NormalizedPluginOptions = {
	onBrokenLink: "error",
	onAmbiguousLink: "error",
	enableFuzzyMatching: false,
	enableCaseInsensitiveLookup: false,
	enableTagLinking: false,
	enableCallouts: false,
	enableBacklinks: false,
	enableTransclusion: false,
	enableMediaEmbeds: false,
	enableTagPages: false,
	enableDefaultStyles: false,
};

function makeProcessor(
	docsRoot: string,
	optionOverrides: Partial<NormalizedPluginOptions> = {},
) {
	return unified()
		.use(remarkParse)
		.use(remarkWikilink, {
			getDocsRoot: () => docsRoot,
			options: { ...DEFAULT_OPTIONS, ...optionOverrides },
		})
		.use(remarkStringify);
}

describe("parseWikiLink", () => {
	test("parses alias and anchor", () => {
		const parsed = parseWikiLink(
			"guide/getting-started#Install|Install guide",
			"[[guide/getting-started#Install|Install guide]]",
		);

		expect(parsed).toEqual({
			raw: "[[guide/getting-started#Install|Install guide]]",
			target: "guide/getting-started",
			alias: "Install guide",
			isEmbed: false,
			subpath: {
				kind: "heading",
				value: "Install",
			},
			isCurrentPageReference: false,
		});
	});

	test("parses note-relative page links", () => {
		expect(parseWikiLink("../shared/Concept", "[[../shared/Concept]]")).toEqual(
			{
				raw: "[[../shared/Concept]]",
				target: "../shared/Concept",
				isEmbed: false,
				isCurrentPageReference: false,
			},
		);
	});

	test("parses embeds and block references", () => {
		const parsed = parseWikiLink(
			"guide/getting-started#^install-block|Install block",
			"![[guide/getting-started#^install-block|Install block]]",
		);

		expect(parsed).toEqual({
			raw: "![[guide/getting-started#^install-block|Install block]]",
			target: "guide/getting-started",
			alias: "Install block",
			isEmbed: true,
			subpath: {
				kind: "block",
				value: "install-block",
			},
			isCurrentPageReference: false,
		});
	});

	test("preserves nested heading fragments", () => {
		expect(
			parseWikiLink("Page#Parent#Child|Child", "[[Page#Parent#Child|Child]]"),
		).toEqual({
			raw: "[[Page#Parent#Child|Child]]",
			target: "Page",
			alias: "Child",
			isEmbed: false,
			subpath: { kind: "heading", value: "Parent#Child" },
			isCurrentPageReference: false,
		});
	});

	test("parses vault-wide heading and block searches", () => {
		expect(parseWikiLink("## Install", "[[## Install]]")).toMatchObject({
			target: "",
			search: "heading",
			subpath: { kind: "heading", value: "Install" },
		});
		expect(
			parseWikiLink("^^install-block", "[[^^install-block]]"),
		).toMatchObject({
			target: "",
			search: "block",
			subpath: { kind: "block", value: "install-block" },
		});
	});

	test("finds standard and embed wikilinks", () => {
		const matches = findWikilinkMatches("See [[Page]] and ![[Embed]]");

		expect(matches).toHaveLength(2);
		expect(matches[0]?.fullMatch).toBe("[[Page]]");
		expect(matches[1]?.fullMatch).toBe("![[Embed]]");
	});
});

describe("buildContentIndex", () => {
	test("indexes pages and headings", async () => {
		const index = await buildContentIndex(fixtureRoot);
		const page = index.byPathKey.get("guide/getting-started");

		expect(page?.routePath).toBe("/guide/getting-started");
		expect(page?.headings.map((heading) => heading.slug)).toContain("install");
		expect(page?.blocks).toEqual([{ id: "install-block" }]);
	});

	test("caches repeated content-index reads when files are unchanged", async () => {
		const first = await getCachedContentIndex(fixtureRoot);
		const second = await getCachedContentIndex(fixtureRoot);

		expect(second).toBe(first);
	});

	test("extracts setext, spaced atx, and explicit heading ids", async () => {
		const index = await buildContentIndex(headingFixtureRoot);
		const page = index.byPathKey.get("guide/variants");

		expect(page?.headings.map(({ preview: _, ...rest }) => rest)).toEqual([
			{ rawText: "Variants", slug: "variants" },
			{
				rawText: "Named Setext",
				slug: "named-setext",
				explicitId: "custom-setext",
			},
			{ rawText: "Spaced ATX Heading", slug: "spaced-atx-heading" },
			{
				rawText: "Custom Anchor",
				slug: "custom-anchor",
				explicitId: "custom-anchor",
			},
		]);
	});

	test("matches Obsidian-compatible heading anchor corpus", async () => {
		const index = await buildContentIndex(compatibilityFixtureRoot);
		const page = index.byPathKey.get("shared/Concept");

		expect(page?.headings.map(({ preview: _, ...heading }) => heading)).toEqual(
			[
				{ rawText: "Concept", slug: "concept" },
				{ rawText: "Café Déjà Vu", slug: "café-déjà-vu" },
				{ rawText: "Punctuation: A/B & C", slug: "punctuation-ab--c" },
				{ rawText: "😀 Emoji Heading", slug: "-emoji-heading" },
				{ rawText: "重复 标题", slug: "重复-标题" },
				{ rawText: "Duplicate", slug: "duplicate" },
				{ rawText: "Duplicate", slug: "duplicate-1" },
				{
					rawText: "Explicit Anchor",
					slug: "explicit-anchor",
					explicitId: "explicit-anchor",
				},
			],
		);
	});

	test("extracts frontmatter titles and aliases", async () => {
		const index = await buildContentIndex(aliasFixtureRoot);
		const page = index.byPathKey.get("guide/getting-started");

		expect(page?.title).toBe("Onboarding Guide");
		expect(page?.aliases).toEqual(["Start Here", "Kickoff"]);
		expect(index.byTitle.get("onboarding guide")?.[0]?.pathKey).toBe(
			"guide/getting-started",
		);
		expect(index.byAlias.get("start here")?.[0]?.pathKey).toBe(
			"guide/getting-started",
		);
	});
	test("indexes attachment files and inline tags", async () => {
		const index = await buildContentIndex(assetsFixtureRoot);

		expect(index.assets.map((asset) => asset.pathKey)).toContain("image.png");
		expect(index.byTag.get("asset-test")?.[0]?.pathKey).toBe("");
		expect(index.byAssetPath.get("image.png")?.urlPath).toBe("/image.png");
	});
});

describe("resolveWikiLink", () => {
	test("resolves exact path links", async () => {
		const index = await buildContentIndex(fixtureRoot);
		const currentPage = index.byPathKey.get("")!;

		const result = resolveWikiLink(
			parseWikiLink("guide/getting-started", "[[guide/getting-started]]"),
			{
				currentPage,
				index,
			},
		);

		expect(result).toMatchObject({
			status: "ok",
			href: "/guide/getting-started",
			label: "getting started",
		});
	});

	test("resolves relative wikilinks from the current note", async () => {
		const index = await buildContentIndex(compatibilityFixtureRoot);
		const currentPage = index.byPathKey.get("notes/current");

		expect(currentPage).toBeDefined();

		const pageResult = resolveWikiLink(
			parseWikiLink("../shared/Concept", "[[../shared/Concept]]"),
			{ currentPage: currentPage!, index },
		);
		const headingResult = resolveWikiLink(
			parseWikiLink(
				"../shared/Concept#Café Déjà Vu",
				"[[../shared/Concept#Café Déjà Vu]]",
			),
			{ currentPage: currentPage!, index },
		);
		const explicitIdResult = resolveWikiLink(
			parseWikiLink(
				"../shared/Concept#EXPLICIT-ANCHOR",
				"[[../shared/Concept#EXPLICIT-ANCHOR]]",
			),
			{ currentPage: currentPage!, index },
		);

		expect(pageResult).toMatchObject({
			status: "ok",
			href: "/shared/Concept",
		});
		expect(headingResult).toMatchObject({
			status: "ok",
			href: "/shared/Concept#café-déjà-vu",
		});
		expect(explicitIdResult).toMatchObject({
			status: "ok",
			href: "/shared/Concept#explicit-anchor",
		});
		expect(index.backlinks.get("/shared/Concept")).toEqual([
			{ routePath: "/notes/current", title: "current" },
		]);
	});

	test("does not fall back from an unresolved relative wikilink", async () => {
		const index = await buildContentIndex(compatibilityFixtureRoot);
		const currentPage = index.byPathKey.get("notes/current")!;

		const result = resolveWikiLink(
			parseWikiLink("../missing/Concept", "[[../missing/Concept]]"),
			{ currentPage, index },
		);

		expect(result.status).toBe("broken-page");
	});

	test("resolves basename links when unique", async () => {
		const index = await buildContentIndex(fixtureRoot);
		const currentPage = index.byPathKey.get("")!;

		const result = resolveWikiLink(
			parseWikiLink("advanced#Advanced Usage", "[[advanced#Advanced Usage]]"),
			{
				currentPage,
				index,
			},
		);

		expect(result).toMatchObject({
			status: "ok",
			href: "/guide/advanced#advanced-usage",
			label: "Advanced Usage",
		});
	});
	test("resolves unique vault-wide heading and block searches", async () => {
		const index = await buildContentIndex(fixtureRoot);
		const currentPage = index.byPathKey.get("")!;

		const headingResult = resolveWikiLink(
			parseWikiLink("## Advanced Usage", "[[## Advanced Usage]]"),
			{ currentPage, index },
		);
		const blockResult = resolveWikiLink(
			parseWikiLink("^^install-block", "[[^^install-block]]"),
			{ currentPage, index },
		);

		expect(headingResult).toMatchObject({
			status: "ok",
			href: "/guide/advanced#advanced-usage",
		});
		expect(blockResult).toMatchObject({
			status: "ok",
			href: "/guide/getting-started#^install-block",
		});
	});

	test("resolves title and alias lookups when unique", async () => {
		const index = await buildContentIndex(aliasFixtureRoot);
		const currentPage = index.byPathKey.get("")!;

		const aliasResult = resolveWikiLink(
			parseWikiLink("Start Here", "[[Start Here]]"),
			{
				currentPage,
				index,
			},
		);
		const titleResult = resolveWikiLink(
			parseWikiLink("Onboarding Guide", "[[Onboarding Guide]]"),
			{
				currentPage,
				index,
			},
		);

		expect(aliasResult).toMatchObject({
			status: "ok",
			href: "/guide/getting-started",
		});
		expect(titleResult).toMatchObject({
			status: "ok",
			href: "/guide/getting-started",
		});
	});

	test("reports ambiguous basename links", async () => {
		const index = await buildContentIndex(
			path.resolve(process.cwd(), "tests/fixtures/ambiguous"),
		);
		const currentPage = index.byPathKey.get("")!;

		const result = resolveWikiLink(
			parseWikiLink("getting-started", "[[getting-started]]"),
			{
				currentPage,
				index,
			},
		);

		expect(result.status).toBe("ambiguous-page");
	});

	test("reports ambiguous alias links", async () => {
		const index = await buildContentIndex(aliasAmbiguousFixtureRoot);
		const currentPage = index.byPathKey.get("")!;

		const result = resolveWikiLink(
			parseWikiLink("Shared Alias", "[[Shared Alias]]"),
			{
				currentPage,
				index,
			},
		);

		expect(result.status).toBe("ambiguous-page");
	});

	test("reports broken anchors", async () => {
		const index = await buildContentIndex(fixtureRoot);
		const currentPage = index.byPathKey.get("")!;

		const result = resolveWikiLink(
			parseWikiLink(
				"guide/getting-started#Missing",
				"[[guide/getting-started#Missing]]",
			),
			{
				currentPage,
				index,
			},
		);

		expect(result.status).toBe("broken-anchor");
	});

	test("resolves block references", async () => {
		const index = await buildContentIndex(fixtureRoot);
		const currentPage = index.byPathKey.get("")!;

		const result = resolveWikiLink(
			parseWikiLink(
				"guide/getting-started#^install-block",
				"[[guide/getting-started#^install-block]]",
			),
			{
				currentPage,
				index,
			},
		);

		expect(result).toMatchObject({
			status: "ok",
			href: "/guide/getting-started#^install-block",
			label: "install-block",
		});
	});

	test("keeps exact path matching strict by case", async () => {
		const index = await buildContentIndex(strictFixtureRoot);
		const currentPage = index.byPathKey.get("")!;

		const result = resolveWikiLink(
			parseWikiLink("guide/casesensitive", "[[guide/casesensitive]]"),
			{
				currentPage,
				index,
			},
		);

		expect(result.status).toBe("broken-page");
	});

	test("supports optional fuzzy path matching", async () => {
		const index = await buildContentIndex(strictFixtureRoot);
		const currentPage = index.byPathKey.get("")!;

		const result = resolveWikiLink(
			parseWikiLink("guide/casesensitive", "[[guide/casesensitive]]"),
			{
				currentPage,
				index,
				options: {
					enableFuzzyMatching: true,
				},
			},
		);

		expect(result).toMatchObject({
			status: "ok",
			href: "/guide/CaseSensitive",
		});
	});

	test("rejects malformed empty targets", async () => {
		const index = await buildContentIndex(fixtureRoot);
		const currentPage = index.byPathKey.get("")!;

		const result = resolveWikiLink(parseWikiLink(" |Alias", "[[ |Alias]]"), {
			currentPage,
			index,
		});

		expect(result.status).toBe("broken-page");
	});

	test("resolves richer heading syntax", async () => {
		const index = await buildContentIndex(headingFixtureRoot);
		const currentPage = index.byPathKey.get("")!;

		const setextResult = resolveWikiLink(
			parseWikiLink(
				"guide/variants#Named Setext",
				"[[guide/variants#Named Setext]]",
			),
			{
				currentPage,
				index,
			},
		);
		const spacedAtxResult = resolveWikiLink(
			parseWikiLink(
				"guide/variants#Spaced ATX Heading",
				"[[guide/variants#Spaced ATX Heading]]",
			),
			{
				currentPage,
				index,
			},
		);
		const explicitIdResult = resolveWikiLink(
			parseWikiLink(
				"guide/variants#custom-anchor",
				"[[guide/variants#custom-anchor]]",
			),
			{
				currentPage,
				index,
			},
		);

		expect(setextResult).toMatchObject({
			status: "ok",
			href: "/guide/variants#custom-setext",
		});
		expect(spacedAtxResult).toMatchObject({
			status: "ok",
			href: "/guide/variants#spaced-atx-heading",
		});
		expect(explicitIdResult).toMatchObject({
			status: "ok",
			href: "/guide/variants#custom-anchor",
		});
	});
});

describe("remarkWikilink", () => {
	test("rewrites wikilinks into markdown links", async () => {
		const processor = makeProcessor(fixtureRoot);

		const file = await processor.process({
			value: "Go to [[guide/getting-started#Install|Install guide]].",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		const output1 = String(file);
		expect(output1).toContain(
			'[Install guide](/guide/getting-started#install "Install steps.',
		);
		expect(output1).toEndWith("\n");
	});

	test("rewrites note-relative links end to end", async () => {
		const processor = makeProcessor(compatibilityFixtureRoot);

		const file = await processor.process({
			value:
				"See [[../shared/Concept#Café Déjà Vu]] and [[../shared/Concept]].",
			path: path.resolve(compatibilityFixtureRoot, "notes/current.md"),
		});

		expect(String(file)).toContain(
			"[Café Déjà Vu](/shared/Concept#café-déjà-vu)",
		);
		expect(String(file)).toContain("[Concept](/shared/Concept)");
	});

	test("rewrites unique vault-wide searches end to end", async () => {
		const processor = makeProcessor(fixtureRoot);

		const file = await processor.process({
			value: "See [[## Advanced Usage]] and [[^^install-block]].",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(String(file)).toContain(
			"[Advanced Usage](/guide/advanced#advanced-usage",
		);
		expect(String(file)).toContain(
			"[install-block](/guide/getting-started#^install-block)",
		);
	});

	test("rewrites frontmatter title and alias links end to end", async () => {
		const processor = makeProcessor(aliasFixtureRoot);

		const file = await processor.process({
			value: "See [[Onboarding Guide]] and [[Start Here]].",
			path: path.resolve(aliasFixtureRoot, "index.md"),
		});

		expect(String(file)).toContain(
			"[Onboarding Guide](/guide/getting-started)",
		);
		expect(String(file)).toContain("[Start Here](/guide/getting-started)");
	});

	test("appends backlinks HTML end to end", async () => {
		const processor = makeProcessor(fixtureRoot, {
			enableBacklinks: true,
		});

		const file = await processor.process({
			value: "Getting started content.",
			path: path.resolve(fixtureRoot, "guide/getting-started.md"),
		});

		expect(String(file)).toContain('<div class="obsidian-backlinks">');
		expect(String(file)).toContain('<a href="/">');
	});

	test("supports current-page anchors", async () => {
		const processor = makeProcessor(fixtureRoot);

		const file = await processor.process({
			value: "Jump to [[#Overview]].",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		const output2 = String(file);
		expect(output2).toContain('[Overview](#overview "Read');
		expect(output2).toEndWith("\n");
	});

	test("rewrites block references into markdown links", async () => {
		const processor = makeProcessor(fixtureRoot);

		const file = await processor.process({
			value: "Jump to [[guide/getting-started#^install-block]].",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(String(file)).toBe(
			"Jump to [install-block](/guide/getting-started#^install-block).\n",
		);
	});

	test("rewrites embeds into embed html anchors", async () => {
		const processor = makeProcessor(fixtureRoot);

		const file = await processor.process({
			value: "![[guide/getting-started#Install|Install guide]]",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(String(file)).toBe(
			'<a class="obsidian-embed" data-obsidian-embed="true" href="/guide/getting-started#install">Install guide</a>\n',
		);
	});
});

describe("transclusion", () => {
	test("transclubes full page content", async () => {
		const processor = makeProcessor(fixtureRoot, {
			enableTransclusion: true,
		});
		const file = await processor.process({
			value: "![[guide/getting-started]]",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		const output = String(file);
		expect(output).toContain('class="obsidian-transclusion"');
		expect(output).toContain("Getting Started");
	});

	test("transclubes heading section only", async () => {
		const processor = makeProcessor(fixtureRoot, {
			enableTransclusion: true,
		});
		const file = await processor.process({
			value: "![[guide/getting-started#Install]]",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		const output = String(file);
		expect(output).toContain('class="obsidian-transclusion"');
		expect(output).toContain("Install");
		expect(output).not.toContain("Getting Started\n");
	});
	test("renders GFM tables inside transcluded content", async () => {
		const processor = makeProcessor(transclusionFeaturesFixtureRoot, {
			enableTransclusion: true,
		});
		const file = await processor.process({
			value: "![[source]]",
			path: path.resolve(transclusionFeaturesFixtureRoot, "index.md"),
		});
		const output = String(file);
		expect(output).toContain("<table>");
		expect(output).toContain("<th>Syntax</th>");
		expect(output).toContain("Transclude full page content");
	});

	test("transclubes block reference only", async () => {
		const processor = makeProcessor(fixtureRoot, {
			enableTransclusion: true,
		});
		const file = await processor.process({
			value: "![[guide/getting-started#^install-block]]",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		const output = String(file);
		expect(output).toContain('class="obsidian-transclusion"');
		expect(output).toContain("Install steps");
	});

	test("recursively transcludes nested embeds", async () => {
		const processor = makeProcessor(recursiveTransclusionFixtureRoot, {
			enableTransclusion: true,
		});
		const file = await processor.process({
			value: "![[guide/middle]]",
			path: path.resolve(recursiveTransclusionFixtureRoot, "index.md"),
		});
		const output = String(file);
		expect(output).toContain('class="obsidian-transclusion"');
		expect(output).toContain("Middle content");
		expect(output).toContain("Deep content here");
	});

	test("detects circular transclusion and preserves original syntax", async () => {
		const processor = makeProcessor(circularTransclusionFixtureRoot, {
			enableTransclusion: true,
		});
		const file = await processor.process({
			value: "![[guide/a]]",
			path: path.resolve(circularTransclusionFixtureRoot, "index.md"),
		});
		const output = String(file);
		expect(output).toContain("Content A");
		expect(output).toContain("Content B");
		expect(
			file.messages.some((m) => String(m).includes("Circular transclusion")),
		).toBe(true);
	});

	test("respects max transclusion depth", async () => {
		const processor = makeProcessor(deepTransclusionFixtureRoot, {
			enableTransclusion: true,
		});
		const file = await processor.process({
			value: "![[guide/level1]]",
			path: path.resolve(deepTransclusionFixtureRoot, "index.md"),
		});
		const output = String(file);
		expect(output).toContain("Level 1");
		expect(output).toContain("Level 5");
		expect(output).not.toContain("Level 6");
		expect(
			file.messages.some((m) => String(m).includes("Max transclusion depth")),
		).toBe(true);
	});
	test("applies Obsidian transforms inside transcluded content", async () => {
		const processor = makeProcessor(transclusionFeaturesFixtureRoot, {
			enableCallouts: true,
			enableTransclusion: true,
		});
		const file = await processor.process({
			value: "![[source]]",
			path: path.resolve(transclusionFeaturesFixtureRoot, "index.md"),
		});

		const output = String(file);
		expect(output).toContain('data-callout="tip"');
		expect(output).toContain("<mark>Important</mark>");
		expect(output).toContain("First line. Second line.");
		expect(output).not.toContain("[!tip]");
	});
});

describe("tag linking", () => {
	test("rewrites tags into markdown links", async () => {
		const processor = makeProcessor(fixtureRoot, {
			enableTagLinking: true,
		});

		const file = await processor.process({
			value: "See #tag and #other_tag.",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(String(file)).toBe(
			"See [#tag](/tags/tag) and [#other\\_tag](/tags/other_tag).\n",
		);
	});
});

describe("callouts", () => {
	test("rewrites obsidian callouts into callout html", async () => {
		const processor = makeProcessor(fixtureRoot, {
			enableCallouts: true,
		});

		const file = await processor.process({
			value: "> [!tip] Pro Tip\n> Body text",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		const output = String(file);
		expect(output).toContain(
			'<div class="callout callout-tip" data-callout="tip">',
		);
		expect(output).toContain('<div class="callout-title">Pro Tip</div>');
		expect(output).toContain('<div class="callout-content">');
		expect(output).toContain("Body text");
		expect(output).toContain("</div></div>");
	});
});

describe("case-insensitive lookup", () => {
	test("forwards case-insensitive lookup option through remark resolution", async () => {
		const processor = makeProcessor(strictFixtureRoot, {
			enableCaseInsensitiveLookup: true,
		});

		const file = await processor.process({
			value: "Go to [[guide/casesensitive]].",
			path: path.resolve(strictFixtureRoot, "index.md"),
		});

		expect(String(file)).toBe("Go to [CaseSensitive](/guide/CaseSensitive).\n");
	});
});

describe("inline block ID indexing", () => {
	test("indexes standalone block IDs", async () => {
		const index = await buildContentIndex(inlineBlocksFixtureRoot);
		const page = index.byPathKey.get("guide/inline-target");

		expect(page?.blocks.map((b) => b.id)).toContain("standalone-block");
	});

	test("indexes inline block IDs appended to paragraph text", async () => {
		const index = await buildContentIndex(inlineBlocksFixtureRoot);
		const page = index.byPathKey.get("guide/inline-target");

		expect(page?.blocks.map((b) => b.id)).toContain("inline-block");
	});

	test("resolves wikilink to an inline block ID", async () => {
		const index = await buildContentIndex(inlineBlocksFixtureRoot);
		const currentPage = index.byPathKey.get("")!;

		const result = resolveWikiLink(
			parseWikiLink(
				"guide/inline-target#^inline-block",
				"[[guide/inline-target#^inline-block]]",
			),
			{ currentPage, index },
		);

		expect(result).toMatchObject({
			status: "ok",
			href: "/guide/inline-target#^inline-block",
		});
	});
});

describe("frontmatter tags", () => {
	test("indexes tags from frontmatter", async () => {
		const index = await buildContentIndex(tagsFixtureRoot);
		const page = index.byPathKey.get("guide/tagged-page");

		expect(page?.tags).toEqual(["tutorial", "obsidian"]);
	});

	test("builds byTag lookup map", async () => {
		const index = await buildContentIndex(tagsFixtureRoot);

		expect(index.byTag.get("tutorial")?.[0]?.pathKey).toBe("guide/tagged-page");
		expect(index.byTag.get("obsidian")?.[0]?.pathKey).toBe("guide/tagged-page");
	});
});

describe("backlinks caching", () => {
	test("returns the same map object on repeated calls with same index", async () => {
		const { getCachedBacklinksIndex } = await import("../src/backlinks");
		const index = await buildContentIndex(fixtureRoot);

		const first = await getCachedBacklinksIndex(index);
		const second = await getCachedBacklinksIndex(index);

		expect(second).toBe(first);
	});
});

describe("tag regex", () => {
	test("rewrites word tags", async () => {
		const processor = makeProcessor(fixtureRoot, { enableTagLinking: true });
		const file = await processor.process({
			value: "See #tutorial and #my-tag.",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		expect(String(file)).toContain("[#tutorial](/tags/tutorial)");
		expect(String(file)).toContain("[#my-tag](/tags/my-tag)");
	});

	test("does not rewrite purely numeric tags (e.g. issue numbers)", async () => {
		const processor = makeProcessor(fixtureRoot, { enableTagLinking: true });
		const file = await processor.process({
			value: "See issue #123 and PR #456.",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		const output = String(file);
		// Pure-numeric strings after # are not valid Obsidian tags
		expect(output).not.toContain("/tags/123");
		expect(output).not.toContain("/tags/456");
	});

	test("does not rewrite tags inside URL fragments", async () => {
		const processor = makeProcessor(fixtureRoot, { enableTagLinking: true });
		const file = await processor.process({
			value: "See https://example.com/page#section for details.",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		const output = String(file);
		// URL fragment preceded by a word char — should not be rewritten
		expect(output).not.toContain("/tags/section");
	});
});
describe("unicode tag regex", () => {
	test("rewrites Unicode letter and emoji tags", async () => {
		const processor = makeProcessor(fixtureRoot, {
			enableTagLinking: true,
		});
		const file = await processor.process({
			value: "#δοκιμή #🚀",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(String(file)).toContain("[#δοκιμή](/tags/δοκιμή)");
		expect(String(file)).toContain("[#🚀](/tags/🚀)");
	});
});

describe("callout foldable state", () => {
	test("renders static callout as div", async () => {
		const processor = makeProcessor(fixtureRoot, { enableCallouts: true });
		const file = await processor.process({
			value: "> [!note] Title\n> Body",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		const output = String(file);
		expect(output).toContain(
			'<div class="callout callout-note" data-callout="note">',
		);
		expect(output).not.toContain("<details");
	});

	test("renders collapsed callout (-) as closed details element", async () => {
		const processor = makeProcessor(fixtureRoot, { enableCallouts: true });
		const file = await processor.process({
			value: "> [!note]- Collapsed\n> Body",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		const output = String(file);
		expect(output).toContain(
			'<details class="callout callout-note" data-callout="note">',
		);
		expect(output).toContain("<summary");
		expect(output).not.toContain("open");
	});

	test("renders expanded callout (+) as open details element", async () => {
		const processor = makeProcessor(fixtureRoot, { enableCallouts: true });
		const file = await processor.process({
			value: "> [!tip]+ Expanded\n> Body",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		const output = String(file);
		expect(output).toContain(
			'<details class="callout callout-tip" data-callout="tip" open>',
		);
		expect(output).toContain("<summary");
	});
});

describe("Obsidian comment stripping", () => {
	test("strips inline %% comments %% from text", async () => {
		const processor = makeProcessor(fixtureRoot);
		const file = await processor.process({
			value: "Before %% hidden comment %% after.",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		const output = String(file);
		expect(output).not.toContain("hidden comment");
		expect(output).toContain("Before");
		expect(output).toContain("after.");
	});

	test("strips multi-line block %% comments %%", async () => {
		const processor = makeProcessor(fixtureRoot);
		const file = await processor.process({
			value: "%%\nprivate draft content\n%%",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		const output = String(file);
		expect(output).not.toContain("private draft content");
	});

	test("leaves non-comment text untouched", async () => {
		const processor = makeProcessor(fixtureRoot);
		const file = await processor.process({
			value: "Normal text with no comments.",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		expect(String(file)).toContain("Normal text with no comments.");
	});
});

describe("callout type aliases", () => {
	test("maps 'summary' alias to abstract icon", async () => {
		const processor = makeProcessor(fixtureRoot, { enableCallouts: true });
		const file = await processor.process({
			value: "> [!summary] Title\n> Body",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		const output = String(file);
		expect(output).toContain("callout-abstract");
	});

	test("maps 'done' alias to success icon", async () => {
		const processor = makeProcessor(fixtureRoot, { enableCallouts: true });
		const file = await processor.process({
			value: "> [!done] Title\n> Body",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		expect(String(file)).toContain("callout-success");
	});

	test("maps 'fail' alias to failure type", async () => {
		const processor = makeProcessor(fixtureRoot, { enableCallouts: true });
		const file = await processor.process({
			value: "> [!fail] Title\n> Body",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		expect(String(file)).toContain("callout-failure");
	});

	test("maps 'attention' alias to caution type", async () => {
		const processor = makeProcessor(fixtureRoot, { enableCallouts: true });
		const file = await processor.process({
			value: "> [!attention] Title\n> Body",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		expect(String(file)).toContain("callout-caution");
	});
});

describe("setext heading transclusion", () => {
	test("transclubes a setext H1 section", async () => {
		const processor = makeProcessor(setextFixtureRoot, {
			enableTransclusion: true,
		});
		const file = await processor.process({
			value: "![[guide/setext-page#Install]]",
			path: path.resolve(setextFixtureRoot, "index.md"),
		});
		const output = String(file);
		expect(output).toContain('class="obsidian-transclusion"');
		expect(output).toContain("Install steps here");
		expect(output).not.toContain("Introduction content");
	});

	test("transclubes a setext H2 section", async () => {
		const processor = makeProcessor(setextFixtureRoot, {
			enableTransclusion: true,
		});
		const file = await processor.process({
			value: "![[guide/setext-page#Advanced]]",
			path: path.resolve(setextFixtureRoot, "index.md"),
		});
		const output = String(file);
		expect(output).toContain("Advanced content here");
		expect(output).not.toContain("Install steps here");
	});
});

describe("tag page generation", () => {
	test("generateTagPages produces one page per unique tag", async () => {
		const { generateTagPages } = await import("../src/tag-pages");
		const index = await buildContentIndex(tagsFixtureRoot);
		const pages = generateTagPages(index);

		const routes = pages.map((p) => p.routePath);
		expect(routes).toContain("/tags/tutorial");
		expect(routes).toContain("/tags/obsidian");
	});

	test("generated tag page lists pages with that tag", async () => {
		const { generateTagPages } = await import("../src/tag-pages");
		const index = await buildContentIndex(tagsFixtureRoot);
		const pages = generateTagPages(index);

		const tutorialPage = pages.find((p) => p.routePath === "/tags/tutorial");
		expect(tutorialPage?.content).toContain("Tagged Guide");
		expect(tutorialPage?.content).toContain("/guide/tagged-page");
	});
});

describe("footnote fixes", () => {
	test("definition lines are stripped from rendered output", async () => {
		const processor = makeProcessor(fixtureRoot);
		const file = await processor.process({
			value: "Reference[^1] here.\n\n[^1]: The definition text.",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		const output = String(file);
		// Raw definition syntax must not appear as literal text
		expect(output).not.toContain("[^1]:");
		// The footnote reference superscript must be present
		expect(output).toContain('id="fnref-1"');
		// The definition must be rendered in the footnotes list
		expect(output).toContain("The definition text.");
		expect(output).toContain('<ol class="footnotes">');
	});

	test("superscript title is populated even when definition appears after reference", async () => {
		const processor = makeProcessor(fixtureRoot);
		const file = await processor.process({
			value: "Reference[^note] here.\n\n[^note]: Def text.",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		const output = String(file);
		expect(output).toContain('title="Def text."');
	});

	test("supports indented multi-line definitions", async () => {
		const processor = makeProcessor(fixtureRoot);
		const file = await processor.process({
			value: "Reference[^long].\n\n[^long]: First line.\n  Second line.",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		const output = String(file);
		expect(output).toContain("First line. Second line.");
		expect(output).not.toContain("Second line.</p>");
	});

	test("multiple definitions all stripped and all rendered in list", async () => {
		// Use multi-word definitions — single-word definitions (e.g. "[^a]: Alpha.")
		// are indistinguishable from link definitions in remark-parse and stay as
		// linkReference nodes our text visitor won't see. That is a remark-parse
		// limitation, not a plugin bug; real Obsidian notes always use prose.
		const processor = makeProcessor(fixtureRoot);
		const file = await processor.process({
			value:
				"A[^a] and B[^b].\n\n[^a]: Alpha definition text.\n\n[^b]: Beta definition text.",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		const output = String(file);
		expect(output).not.toContain("[^a]:");
		expect(output).not.toContain("[^b]:");
		expect(output).toContain('id="fn-a"');
		expect(output).toContain('id="fn-b"');
		expect(output).toContain("Alpha definition text.");
		expect(output).toContain("Beta definition text.");
	});

	test("inline footnote ^[text] renders as numbered superscript", async () => {
		const processor = makeProcessor(fixtureRoot);
		const file = await processor.process({
			value: "Inline footnote^[This is inline content] here.",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		const output = String(file);
		expect(output).toContain('id="fnref-inline-1"');
		expect(output).toContain('title="This is inline content"');
		expect(output).toContain('id="fn-inline-1"');
		expect(output).toContain('<ol class="footnotes">');
		expect(output).toContain("This is inline content");
	});

	test("inline and label footnotes coexist in same document", async () => {
		const processor = makeProcessor(fixtureRoot);
		const file = await processor.process({
			value:
				"Label[^lbl] and inline^[Inline text] together.\n\n[^lbl]: Label def.",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		const output = String(file);
		expect(output).toContain('id="fnref-lbl"');
		expect(output).toContain('id="fnref-inline-1"');
		expect(output).toContain('id="fn-lbl"');
		expect(output).toContain('id="fn-inline-1"');
	});
});

describe("nested tag linking", () => {
	test("rewrites nested #parent/child tag into a link", async () => {
		const processor = makeProcessor(fixtureRoot, { enableTagLinking: true });
		const file = await processor.process({
			value: "See #parent/child here.",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		expect(String(file)).toContain("[#parent/child](/tags/parent/child)");
	});

	test("rewrites deeply nested #a/b/c tag", async () => {
		const processor = makeProcessor(fixtureRoot, { enableTagLinking: true });
		const file = await processor.process({
			value: "Topic #a/b/c nested.",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		expect(String(file)).toContain("[#a/b/c](/tags/a/b/c)");
	});

	test("does not match URL fragments as nested tags", async () => {
		const processor = makeProcessor(fixtureRoot, { enableTagLinking: true });
		const file = await processor.process({
			value: "See https://example.com/page#section/sub for details.",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		expect(String(file)).not.toContain("/tags/section");
	});
});

describe("unicode tag linking", () => {
	test("rewrites Latin extended tags (accented chars)", async () => {
		const processor = makeProcessor(fixtureRoot, { enableTagLinking: true });
		const file = await processor.process({
			value: "Tag #résumé here.",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		expect(String(file)).toContain("/tags/r");
		expect(String(file)).toContain("sum");
	});

	test("rewrites CJK unicode tags", async () => {
		const processor = makeProcessor(fixtureRoot, { enableTagLinking: true });
		const file = await processor.process({
			value: "Tag #中文 here.",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		expect(String(file)).toContain("/tags/中文");
	});
});

describe("cssclasses wrapper", () => {
	test("wraps page content in classed div when cssclasses are set", async () => {
		const processor = makeProcessor(cssclassesFixtureRoot);
		const file = await processor.process({
			value: "Content here.",
			path: path.resolve(cssclassesFixtureRoot, "guide/styled.md"),
		});
		const output = String(file);
		expect(output).toContain('<div class="custom-layout dark-theme">');
		expect(output).toContain("Content here.");
		expect(output).toContain("</div>");
	});

	test("does not inject wrapper when cssclasses is empty", async () => {
		const processor = makeProcessor(cssclassesFixtureRoot);
		const file = await processor.process({
			value: "Plain content.",
			path: path.resolve(cssclassesFixtureRoot, "index.md"),
		});
		const output = String(file);
		expect(output).not.toContain('<div class="');
		expect(output).toContain("Plain content.");
	});
});

describe("callout type coverage", () => {
	test("renders todo callout type", async () => {
		const processor = makeProcessor(fixtureRoot, { enableCallouts: true });
		const file = await processor.process({
			value: "> [!todo] My Task\n> Do the thing",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		expect(String(file)).toContain("callout-todo");
	});

	test("maps hint alias to tip", async () => {
		const processor = makeProcessor(fixtureRoot, { enableCallouts: true });
		const file = await processor.process({
			value: "> [!hint] A Hint\n> Body",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		expect(String(file)).toContain("callout-tip");
	});

	test("maps important alias to tip", async () => {
		const processor = makeProcessor(fixtureRoot, { enableCallouts: true });
		const file = await processor.process({
			value: "> [!important] Important\n> Body",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		expect(String(file)).toContain("callout-tip");
	});

	test("maps error alias to danger", async () => {
		const processor = makeProcessor(fixtureRoot, { enableCallouts: true });
		const file = await processor.process({
			value: "> [!error] An Error\n> Body",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		expect(String(file)).toContain("callout-danger");
	});

	test("maps cite alias to quote", async () => {
		const processor = makeProcessor(fixtureRoot, { enableCallouts: true });
		const file = await processor.process({
			value: "> [!cite] Citation\n> Body",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		expect(String(file)).toContain("callout-quote");
	});
});

describe("nested callouts", () => {
	test("processes nested callout (post-order)", async () => {
		const processor = makeProcessor(fixtureRoot, { enableCallouts: true });
		const file = await processor.process({
			value: "> [!note] Outer\n> > [!tip] Inner\n> > Content",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		const output = String(file);
		expect(output).toContain('class="callout callout-note"');
		expect(output).toContain('class="callout callout-tip"');
		expect(output).toContain('<div class="callout-title">Outer</div>');
		expect(output).toContain('<div class="callout-title">Inner</div>');
		expect(output).toContain("Content");
		// Inner callout must be nested inside outer (appear after outer's opening tag)
		const outerIdx = output.indexOf("callout-note");
		const innerIdx = output.indexOf("callout-tip");
		expect(innerIdx).toBeGreaterThan(outerIdx);
	});

	test("processes triple-nested callouts", async () => {
		const processor = makeProcessor(fixtureRoot, { enableCallouts: true });
		const file = await processor.process({
			value:
				"> [!note] Level 1\n> > [!tip] Level 2\n> > > [!warning] Level 3\n> > > Deep",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		const output = String(file);
		expect(output).toContain("callout-note");
		expect(output).toContain("callout-tip");
		expect(output).toContain("callout-warning");
		// Verify inner-to-outer ordering
		const idx1 = output.indexOf("callout-note");
		const idx2 = output.indexOf("callout-tip");
		const idx3 = output.indexOf("callout-warning");
		expect(idx3).toBeGreaterThan(idx2);
		expect(idx2).toBeGreaterThan(idx1);
	});

	test("processes nested callout with foldable state", async () => {
		const processor = makeProcessor(fixtureRoot, { enableCallouts: true });
		const file = await processor.process({
			value: "> [!note]- Collapsed outer\n> > [!tip]+ Expanded inner\n> > Body",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		const output = String(file);
		expect(output).toContain('<details class="callout callout-note"');
		expect(output).toContain(
			'<details class="callout callout-tip" data-callout="tip" open',
		);
		expect(output).toContain("Collapsed outer");
		expect(output).toContain("Expanded inner");
	});
});

describe("nested tag indexing", () => {
	test("indexes the full nested tag path in page.tags", async () => {
		const index = await buildContentIndex(nestedTagsFixtureRoot);
		const page = index.byPathKey.get("guide/nested");
		expect(page?.tags).toContain("frontend/react");
		expect(page?.tags).toContain("tools/bun");
	});

	test("aggregates pages into parent tag segment in byTag", async () => {
		const index = await buildContentIndex(nestedTagsFixtureRoot);
		const frontendPages = index.byTag.get("frontend");
		expect(frontendPages?.some((p) => p.pathKey === "guide/nested")).toBe(true);
	});

	test("aggregates pages into tools parent segment", async () => {
		const index = await buildContentIndex(nestedTagsFixtureRoot);
		const toolsPages = index.byTag.get("tools");
		expect(toolsPages?.some((p) => p.pathKey === "guide/nested")).toBe(true);
	});
});

describe("nested tag pages", () => {
	test("generates page for full nested tag path", async () => {
		const { generateTagPages } = await import("../src/tag-pages");
		const index = await buildContentIndex(nestedTagsFixtureRoot);
		const pages = generateTagPages(index);
		const routes = pages.map((p) => p.routePath);
		expect(routes).toContain("/tags/frontend/react");
		expect(routes).toContain("/tags/tools/bun");
	});

	test("generates parent tag page that aggregates child-tagged pages", async () => {
		const { generateTagPages } = await import("../src/tag-pages");
		const index = await buildContentIndex(nestedTagsFixtureRoot);
		const pages = generateTagPages(index);
		const frontendPage = pages.find((p) => p.routePath === "/tags/frontend");
		expect(frontendPage).toBeDefined();
		expect(frontendPage?.content).toContain("Nested Tags");
	});
});

describe("tag path URL encoding", () => {
	test("encodes whitespace in tag names", async () => {
		const { encodeTagPathSegment } = await import("../src/tag-pages");
		expect(encodeTagPathSegment("hello world")).toBe("hello%20world");
	});

	test("encodes HTML-reserved characters", async () => {
		const { encodeTagPathSegment } = await import("../src/tag-pages");
		expect(encodeTagPathSegment("a&b")).toBe("a%26b");
		expect(encodeTagPathSegment('a"b')).toBe("a%22b");
		expect(encodeTagPathSegment("a<b>c")).toBe("a%3Cb%3Ec");
	});

	test("encodes URL-reserved characters", async () => {
		const { encodeTagPathSegment } = await import("../src/tag-pages");
		expect(encodeTagPathSegment("a#b")).toBe("a%23b");
		expect(encodeTagPathSegment("a?b")).toBe("a%3Fb");
		expect(encodeTagPathSegment("a%b")).toBe("a%25b");
	});

	test("preserves Unicode letters unencoded", async () => {
		const { encodeTagPathSegment } = await import("../src/tag-pages");
		expect(encodeTagPathSegment("中文")).toBe("中文");
		expect(encodeTagPathSegment("café")).toBe("café");
		expect(encodeTagPathSegment("日本語")).toBe("日本語");
	});

	test("preserves nested tag separators", async () => {
		const { encodeTagPathSegment } = await import("../src/tag-pages");
		expect(encodeTagPathSegment("parent/child")).toBe("parent/child");
		expect(encodeTagPathSegment("a/b/c")).toBe("a/b/c");
	});

	test("preserves hyphens, underscores, and digits", async () => {
		const { encodeTagPathSegment } = await import("../src/tag-pages");
		expect(encodeTagPathSegment("my-tag_v2")).toBe("my-tag_v2");
	});
});

describe("highlight syntax", () => {
	test("converts highlighted text to mark tags", async () => {
		const processor = makeProcessor(fixtureRoot);
		const file = await processor.process({
			value: "This is ==highlighted text==.",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(String(file)).toContain("<mark>highlighted text</mark>");
	});

	test("converts multiple highlights in one line", async () => {
		const processor = makeProcessor(fixtureRoot);
		const file = await processor.process({
			value: "==one== and ==two==",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(String(file)).toContain("<mark>one</mark>");
		expect(String(file)).toContain("<mark>two</mark>");
	});

	test("does not convert highlights inside inline code", async () => {
		const processor = makeProcessor(fixtureRoot);
		const file = await processor.process({
			value: "`==not highlighted==`",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(String(file)).not.toContain("<mark>not highlighted</mark>");
		expect(String(file)).toContain("`==not highlighted==`");
	});
});

describe("media embeds", () => {
	test("renders image embeds as lazy-loaded img tags", async () => {
		const processor = makeProcessor(fixtureRoot, { enableMediaEmbeds: true });
		const file = await processor.process({
			value: "![[image.png]]",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		const output = String(file);
		expect(output).toContain('<img src="/image.png" alt="image.png"');
		expect(output).toContain('loading="lazy"');
	});

	test("renders audio embeds as audio tags", async () => {
		const processor = makeProcessor(fixtureRoot, { enableMediaEmbeds: true });
		const file = await processor.process({
			value: "![[audio.mp3]]",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		const output = String(file);
		expect(output).toContain('audio controls src="/audio.mp3"');
		expect(output).toContain("</audio>");
	});

	test("renders video embeds as video tags", async () => {
		const processor = makeProcessor(fixtureRoot, { enableMediaEmbeds: true });
		const file = await processor.process({
			value: "![[video.mp4]]",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		const output = String(file);
		expect(output).toContain('video controls src="/video.mp4"');
		expect(output).toContain("</video>");
	});

	test("renders pdf embeds as iframes", async () => {
		const processor = makeProcessor(fixtureRoot, { enableMediaEmbeds: true });
		const file = await processor.process({
			value: "![[doc.pdf]]",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		const output = String(file);
		expect(output).toContain('iframe src="/doc.pdf"');
		expect(output).toContain('width="100%" height="600px" frameborder="0"');
		expect(output).toContain("</iframe>");
	});

	test("passes width and height attributes for sized image embeds", async () => {
		const processor = makeProcessor(fixtureRoot, { enableMediaEmbeds: true });
		const file = await processor.process({
			value: "![[image.png|300x200]]",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(String(file)).toContain(
			'<img src="/image.png" alt="image.png" width="300" height="200" loading="lazy" />',
		);
	});

	test("passes only width attribute when only width is provided", async () => {
		const processor = makeProcessor(fixtureRoot, { enableMediaEmbeds: true });
		const file = await processor.process({
			value: "![[image.png|300]]",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(String(file)).toContain(
			'<img src="/image.png" alt="image.png" width="300" loading="lazy" />',
		);
	});

	test("emits a warning for missing media files while still rendering HTML", async () => {
		const processor = makeProcessor(fixtureRoot, { enableMediaEmbeds: true });
		const file = await processor.process({
			value: "![[image.png]]",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(String(file)).toContain('<img src="/image.png" alt="image.png"');
		expect(file.messages).toHaveLength(1);
		expect(String(file.messages[0])).toContain('Image "image.png" not found');
	});
	test("resolves attachment wikilinks", async () => {
		const processor = makeProcessor(assetsFixtureRoot);
		const file = await processor.process({
			value: "[[image.png]]",
			path: path.resolve(assetsFixtureRoot, "index.md"),
		});

		expect(String(file)).toContain("[image.png](/image.png)");
	});

	test("supports PDF page and height fragments", async () => {
		const processor = makeProcessor(assetsFixtureRoot, {
			enableMediaEmbeds: true,
		});
		const file = await processor.process({
			value: "![[Document.pdf#page=3]]\n\n![[Document.pdf#height=400]]",
			path: path.resolve(assetsFixtureRoot, "index.md"),
		});

		const output = String(file);
		expect(output).toContain(
			'<iframe src="/Document.pdf#page=3" width="100%" height="600px"',
		);
		expect(output).toContain(
			'<iframe src="/Document.pdf#height=400" width="100%" height="400px"',
		);
	});

	test("preserves image fragments", async () => {
		const processor = makeProcessor(assetsFixtureRoot, {
			enableMediaEmbeds: true,
		});
		const file = await processor.process({
			value: "![[image.png#outline|100]]",
			path: path.resolve(assetsFixtureRoot, "index.md"),
		});

		expect(String(file)).toContain(
			'<img src="/image.png#outline" alt="image.png" width="100"',
		);
	});
});

describe("backlinks HTML", () => {
	test("returns empty string when there are no backlinks", async () => {
		const { renderBacklinksHtml } = await import("../src/backlinks");

		expect(renderBacklinksHtml([])).toBe("");
	});

	test("renders backlinks panel HTML for backlink refs", async () => {
		const { renderBacklinksHtml } = await import("../src/backlinks");

		const html = renderBacklinksHtml([
			{ routePath: "/", title: "Home" },
			{ routePath: "/guide/advanced", title: "Advanced" },
		]);

		expect(html).toContain('<div class="obsidian-backlinks">');
		expect(html).toContain("<h2>Backlinks</h2>");
		expect(html).toContain('<li><a href="/">Home</a></li>');
		expect(html).toContain('<li><a href="/guide/advanced">Advanced</a></li>');
	});

	test("builds backlinks for linked pages", async () => {
		const { buildBacklinksIndex } = await import("../src/backlinks");
		const index = await buildContentIndex(fixtureRoot);
		const backlinks = await buildBacklinksIndex(index);

		expect(backlinks.get("/guide/getting-started")).toEqual([
			{ routePath: "/", title: "" },
		]);
	});
});

describe("error boundary", () => {
	test("does not crash when processing a file outside the content index", async () => {
		const processor = makeProcessor(fixtureRoot);
		const file = await processor.process({
			value: "[[guide/getting-started]]",
			path: path.resolve(fixtureRoot, "missing.md"),
		});

		expect(String(file)).toContain("guide/getting-started");
		expect(file.messages).toHaveLength(1);
		expect(String(file.messages[0])).toContain("not found in content index");
	});

	test("emits a warning for self-transclusion", async () => {
		const processor = makeProcessor(fixtureRoot, { enableTransclusion: true });
		const file = await processor.process({
			value: "![[index]]",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(String(file)).toContain('data-obsidian-embed="true"');
		expect(file.messages).toHaveLength(1);
		expect(String(file.messages[0])).toContain(
			"Circular transclusion detected",
		);
	});
});

describe("diagnostic modes", () => {
	test("emits a warning instead of throwing when onBrokenLink is warn", async () => {
		const processor = makeProcessor(fixtureRoot, { onBrokenLink: "warn" });
		const file = await processor.process({
			value: "[[nonexistent]]",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(String(file)).toContain("nonexistent");
		expect(file.messages).toHaveLength(1);
		expect(String(file.messages[0])).toContain("[[nonexistent]]");
	});

	test("records fatal broken-link diagnostics when onBrokenLink is error", async () => {
		const processor = makeProcessor(fixtureRoot, { onBrokenLink: "error" });
		const file = await processor.process({
			value: "[[nonexistent]]",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(file.messages).toHaveLength(2);
		expect(String(file.messages[0])).toContain(
			"[rspress-plugin-obsidian-wikilink:broken-page] [[nonexistent]]",
		);
		expect(String(file.messages[1])).toContain("Unexpected error processing");
	});
});

describe("content index resilience", () => {
	test("buildContentIndex skips unreadable files without crashing", async () => {
		const index = await buildContentIndex(fixtureRoot);
		expect(index.pages.length).toBeGreaterThan(0);
		expect(index.byAbsolutePath.size).toBeGreaterThan(0);
	});
});

describe("transclusion embed preservation", () => {
	test("resolveWikilinksInText preserves embed syntax inside transcluded content", async () => {
		const processor = makeProcessor(fixtureRoot, {
			enableTransclusion: true,
		});
		const file = await processor.process({
			value: "![[guide/getting-started]]",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		const output = String(file);
		expect(output).toContain('class="obsidian-transclusion"');
	});
});

describe("malformed frontmatter", () => {
	test("indexes pages with missing frontmatter closing delimiter", async () => {
		const index = await buildContentIndex(fixtureRoot);
		expect(index.pages.length).toBeGreaterThan(0);
	});
});

describe("pluginObsidianWikiLink API", () => {
	test("returns the expected base plugin shape", async () => {
		const { pluginObsidianWikiLink } = await import("../src/index");
		const plugin = pluginObsidianWikiLink();

		expect(plugin.name).toBe("rspress-plugin-obsidian-wikilink");
		expect(plugin.markdown?.remarkPlugins).toBeArray();
		expect(plugin.markdown?.remarkPlugins).toHaveLength(1);
		expect(plugin.config).toBeFunction();
	});

	test("adds globalStyles when default styles are enabled", async () => {
		const { pluginObsidianWikiLink } = await import("../src/index");
		const plugin = pluginObsidianWikiLink({ enableDefaultStyles: true });

		expect(plugin.name).toBe("rspress-plugin-obsidian-wikilink");
		expect(plugin.globalStyles).toBeDefined();
		expect(typeof plugin.globalStyles).toBe("string");
	});

	test("does not add globalStyles by default", async () => {
		const { pluginObsidianWikiLink } = await import("../src/index");
		const pluginDefault = pluginObsidianWikiLink();

		expect("globalStyles" in pluginDefault).toBe(false);
	});

	test("adds addPages when tag pages are enabled", async () => {
		const { pluginObsidianWikiLink } = await import("../src/index");
		const plugin = pluginObsidianWikiLink({ enableTagPages: true });

		expect(plugin.addPages).toBeDefined();
		expect(typeof plugin.addPages).toBe("function");
	});

	test("does not add addPages by default", async () => {
		const { pluginObsidianWikiLink } = await import("../src/index");
		const pluginDefault = pluginObsidianWikiLink();

		expect("addPages" in pluginDefault).toBe(false);
	});
});

describe("duplicate footnote labels", () => {
	test("records a warning when the same footnote label is defined twice", async () => {
		const processor = makeProcessor(fixtureRoot);
		const file = await processor.process({
			value:
				"Text[^1]\n\n[^1]: First definition text.\n[^1]: Second definition text.",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(file.messages.length).toBeGreaterThan(0);
		expect(
			file.messages.some((message) =>
				String(message).includes("Duplicate footnote label"),
			),
		).toBe(true);
	});
});

describe("edge cases", () => {
	test("processes a file with only frontmatter without error", async () => {
		const processor = makeProcessor(fixtureRoot);

		await expect(
			processor.process({
				value: "---\ntitle: Empty\n---",
				path: path.resolve(fixtureRoot, "index.md"),
			}),
		).resolves.toBeDefined();
	});

	test("converts highlights at the start and end of a line", async () => {
		const processor = makeProcessor(fixtureRoot);
		const file = await processor.process({
			value: "==start== middle ==end==",
			path: path.resolve(fixtureRoot, "index.md"),
		});
		const output = String(file);

		expect(output).toContain("<mark>start</mark>");
		expect(output).toContain("<mark>end</mark>");
		expect(output.match(/<mark>/g)?.length).toBe(2);
	});

	test("resolves uppercase basename wikilinks in strict fixtures", async () => {
		const processor = makeProcessor(strictFixtureRoot);
		const file = await processor.process({
			value: "[[CaseSensitive]]",
			path: path.resolve(strictFixtureRoot, "index.md"),
		});

		expect(String(file)).toContain("/guide/CaseSensitive");
		expect(String(file)).toContain("[CaseSensitive]");
	});
});

describe("bundled stylesheet", () => {
	test("ships non-empty source and dist stylesheets with expected classes", async () => {
		const fs = await import("node:fs/promises");
		const sourceStyles = await fs.readFile(
			path.resolve(process.cwd(), "src/styles.css"),
			"utf8",
		);
		const distStyles = await fs.readFile(
			path.resolve(process.cwd(), "dist/styles.css"),
			"utf8",
		);

		expect(sourceStyles.length).toBeGreaterThan(0);
		expect(sourceStyles).toContain(".callout");
		expect(sourceStyles).toContain(".obsidian-backlinks");
		expect(sourceStyles).toContain(".obsidian-transclusion");
		expect(sourceStyles).toContain(".obsidian-embed");
		expect(sourceStyles).toContain("html.dark");
		expect(sourceStyles).toContain("callout-note");
		expect(sourceStyles).toContain("callout-tip");
		expect(sourceStyles).toContain("callout-warning");
		expect(sourceStyles).toContain("callout-danger");
		expect(sourceStyles).toContain("callout-quote");
		expect(distStyles.length).toBeGreaterThan(0);
		expect(distStyles).toContain(".callout");
		expect(distStyles).toContain("html.dark");
	});
});

describe("publish frontmatter", () => {
	test("excludes pages with publish: false from index", async () => {
		const index = await buildContentIndex(publishFixtureRoot);
		expect(index.pages.length).toBe(1);
		expect(index.byPathKey.has("published")).toBe(true);
		expect(index.byPathKey.has("draft")).toBe(false);
	});

	test("includes pages without publish field (defaults to true)", async () => {
		const index = await buildContentIndex(fixtureRoot);
		expect(index.pages.length).toBeGreaterThan(0);
	});
});

describe("complex yaml frontmatter", () => {
	test("parses multi-line arrays and inline arrays correctly", async () => {
		const index = await buildContentIndex(complexYamlFixtureRoot);
		const page = index.byPathKey.get("complex");

		expect(page?.title).toBe("Complex YAML Test");
		expect(page?.aliases).toEqual(["Complex Alias One", "Complex Alias Two"]);
		expect(page?.tags).toEqual(["obsidian", "tutorial", "advanced"]);
		expect(page?.cssclasses).toEqual(["custom-layout", "dark-theme"]);
		expect(page?.publish).toBe(true);
	});

	test("parses inline yaml arrays", async () => {
		const index = await buildContentIndex(complexYamlFixtureRoot);
		const page = index.byPathKey.get("inline");

		expect(page?.title).toBe("Inline YAML Test");
		expect(page?.aliases).toEqual(["Inline Alias", "Another Alias"]);
		expect(page?.tags).toEqual(["inline"]);
		expect(page?.cssclasses).toEqual(["class-one", "class-two"]);
		expect(page?.publish).toBe(true);
	});

	test("parses publish: yes string as true", async () => {
		const index = await buildContentIndex(complexYamlFixtureRoot);
		const page = index.byPathKey.get("inline");
		expect(page?.publish).toBe(true);
	});
});
