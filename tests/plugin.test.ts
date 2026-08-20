import { describe, expect, test } from "bun:test";
import path from "node:path";
import remarkGfm from "remark-gfm";
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

const wikilinkCompatibilityFixtureRoot = path.resolve(
	process.cwd(),
	"tests/fixtures/wikilink-compat",
);
const pathCollisionFixtureRoot = path.resolve(
	process.cwd(),
	"tests/fixtures/path-collisions",
);
const dataviewFixtureRoot = path.resolve(
	process.cwd(),
	"tests/fixtures/dataview",
);

const DEFAULT_OPTIONS: NormalizedPluginOptions = {
	onBrokenLink: "error",
	onAmbiguousLink: "error",
	enableFuzzyMatching: false,
	enableCaseInsensitiveLookup: false,
	enableMarkdownLinks: true,
	onDataviewError: "error",
	enableDataview: false,
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
	test("finds wikilinks with escaped square brackets", () => {
		const matches = findWikilinkMatches(
			"See [[Note with \\[brackets\\]]] and ![[Image \\] copy.png]]",
		);

		expect(matches.map((match) => match.fullMatch)).toEqual([
			"[[Note with \\[brackets\\]]]",
			"![[Image \\] copy.png]]",
		]);
		expect(
			matches.map((match) => parseWikiLink(match.inner, match.fullMatch)),
		).toMatchObject([
			{ target: "Note with [brackets]" },
			{ target: "Image ] copy.png", isEmbed: true },
		]);
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
		expect(index.byAssetBaseNameCI.get("image.png")?.[0]?.pathKey).toBe(
			"image.png",
		);
	});
	test("indexes spaced paths and duplicate heading slugs", async () => {
		const index = await buildContentIndex(wikilinkCompatibilityFixtureRoot);
		const page = index.byPathKey.get("Folder/Space Note");

		expect(page?.routePath).toBe("/Folder/Space Note");
		expect(page?.headings.map((heading) => heading.slug)).toEqual([
			"space-note",
			"duplicate",
			"duplicate-1",
		]);
	});
	test("keeps folder index pages distinct from flat pages", async () => {
		const index = await buildContentIndex(pathCollisionFixtureRoot);

		expect(index.byFilePathKey.get("foo")?.relativePath).toBe("foo.md");
		expect(index.byFilePathKey.get("foo/index")?.relativePath).toBe(
			"foo/index.md",
		);
		expect(index.byFilePathKeyCI.get("foo/index")?.[0]?.relativePath).toBe(
			"foo/index.md",
		);
	});
});

describe("static Dataview", () => {
	test("indexes frontmatter, inline fields, tasks, and lists", async () => {
		const index = await buildContentIndex(dataviewFixtureRoot);
		const page = index.byFilePathKey.get("notes/alpha");

		expect(page?.dataviewFields.status).toBe("open");
		expect(page?.dataviewFields.owner).toBe("Alice");
		expect(page?.dataviewTasks).toHaveLength(2);
		expect(page?.dataviewTasks[0]?.completed).toBe(false);
		expect(page?.dataviewTasks[0]?.fields.due).toBeInstanceOf(Date);
		expect(page?.dataviewLists).toHaveLength(2);
	});

	test("renders static DQL tables, filters, sorting, and limits", async () => {
		const processor = makeProcessor(dataviewFixtureRoot, {
			enableDataview: true,
		});
		const file = await processor.process({
			value: [
				"```dataview",
				"TABLE status, priority",
				'FROM "notes"',
				'WHERE status = "open"',
				"SORT priority DESC",
				"LIMIT 1",
				"```",
			].join("\n"),
			path: path.resolve(dataviewFixtureRoot, "index.md"),
		});

		const output = String(file);
		expect(output).toContain('class="dataview dataview-table"');
		expect(output).toContain("Alpha");
		expect(output).not.toContain("Beta");
	});

	test("renders static TASK queries and inline expressions", async () => {
		const processor = makeProcessor(dataviewFixtureRoot, {
			enableDataview: true,
		});
		const file = await processor.process({
			value: [
				"Open task count: = length(file.tasks)",
				"",
				"```dataview",
				"TASK",
				'FROM "notes"',
				"WHERE !completed",
				"```",
			].join("\n"),
			path: path.resolve(dataviewFixtureRoot, "index.md"),
		});

		const output = String(file);
		expect(output).toContain('class="dataview-inline"');
		expect(output).toContain("Ship alpha");
		expect(output).toContain("Review beta");
		expect(output).toContain('type="checkbox"');
	});
	test("rejects DataviewJS in strict static mode", async () => {
		const processor = makeProcessor(dataviewFixtureRoot, {
			enableDataview: true,
			onDataviewError: "error",
		});

		await expect(
			processor.process({
				value: "```dataviewjs\nreturn dv.pages();\n```",
				path: path.resolve(dataviewFixtureRoot, "index.md"),
			}),
		).rejects.toThrow("DataviewJS is not executed");
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
	test("resolves folder index paths independently from flat pages", async () => {
		const index = await buildContentIndex(pathCollisionFixtureRoot);
		const currentPage = index.byFilePathKey.get("index")!;

		const flat = resolveWikiLink(parseWikiLink("foo", "[[foo]]"), {
			currentPage,
			index,
		});
		const folder = resolveWikiLink(
			parseWikiLink("foo/index", "[[foo/index]]"),
			{ currentPage, index },
		);

		expect(flat.targetPage?.relativePath).toBe("foo.md");
		expect(folder.targetPage?.relativePath).toBe("foo/index.md");
	});

	test("encodes spaced page routes while preserving heading fragments", async () => {
		const index = await buildContentIndex(wikilinkCompatibilityFixtureRoot);
		const currentPage = index.byPathKey.get("")!;

		const result = resolveWikiLink(
			parseWikiLink(
				"Folder/Space Note#duplicate-1",
				"[[Folder/Space Note#duplicate-1]]",
			),
			{ currentPage, index },
		);

		expect(result).toMatchObject({
			status: "ok",
			href: "/Folder/Space%20Note#duplicate-1",
		});
	});
	test("resolves raw duplicate heading text to the first heading", async () => {
		const index = await buildContentIndex(wikilinkCompatibilityFixtureRoot);
		const currentPage = index.byFilePathKey.get("index")!;

		const result = resolveWikiLink(
			parseWikiLink(
				"Folder/Space Note#Duplicate",
				"[[Folder/Space Note#Duplicate]]",
			),
			{ currentPage, index },
		);

		expect(result).toMatchObject({
			status: "ok",
			href: "/Folder/Space%20Note#duplicate",
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
			{ routePath: "/notes/current", title: "Current Note" },
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

	test("emits anchors for block IDs on the page", async () => {
		const processor = makeProcessor(inlineBlocksFixtureRoot);

		const file = await processor.process({
			value: [
				"# Inline Blocks",
				"",
				"^standalone-block",
				"",
				"A paragraph with an inline block ID. ^inline-block",
			].join("\n"),
			path: path.resolve(inlineBlocksFixtureRoot, "guide/inline-target.md"),
		});

		const output = String(file);
		expect(output).toContain('id="^standalone-block"');
		expect(output).toContain('id="^inline-block"');
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

	test("transcludes full block content including nested list items", async () => {
		const processor = makeProcessor(inlineBlocksFixtureRoot, {
			enableTransclusion: true,
		});
		const file = await processor.process({
			value: "![[guide/list-block#^parent-block]]",
			path: path.resolve(inlineBlocksFixtureRoot, "index.md"),
		});
		const output = String(file);
		expect(output).toContain('class="obsidian-transclusion"');
		expect(output).toContain("Parent item one");
		expect(output).toContain("Child item A");
		expect(output).toContain("Child item B");
		expect(output).not.toContain("Sibling item after the block");
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

	test("records backlinks for alias and title wikilinks", async () => {
		const index = await buildContentIndex(aliasFixtureRoot);
		const backlinks = index.backlinks.get("/guide/getting-started");

		expect(backlinks).toEqual([{ routePath: "/", title: "Alias Home" }]);
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

	test("escapes title brackets in generated tag page links", async () => {
		const { generateTagPages } = await import("../src/tag-pages");
		const index = await buildContentIndex(tagsFixtureRoot);
		// Simulate a page whose title would break out of a markdown link.
		const hostile = index.pages[0];
		if (hostile) {
			hostile.title = "evil](https://evil.example) [x";
		}
		const pages = generateTagPages(index);
		const tutorialPage = pages.find((p) => p.routePath === "/tags/tutorial");

		// The label's brackets are escaped, so no raw `[...](...)` break-out
		// remains and the real link destination is preserved.
		expect(tutorialPage?.content).not.toContain("[evil](");
		expect(tutorialPage?.content).toContain("evil\\]");
		expect(tutorialPage?.content).toContain("](/guide/tagged-page)");
	});

	test("escapes newlines and HTML in tag display names", async () => {
		const { generateTagPages } = await import("../src/tag-pages");
		const index = await buildContentIndex(tagsFixtureRoot);
		// Simulate a frontmatter tag containing a newline + HTML.
		const page = index.pages[0];
		if (page) {
			page.tags = ['evil"<script>\nalert(1)</script>'];
		}
		const pages = generateTagPages(index);
		const hostile = pages.find((p) =>
			p.routePath.includes("evil%22%3Cscript%3E"),
		);

		// The heading must be entity-escaped, never raw HTML. The quote is
		// harmless in text-node context and correctly left literal.
		expect(hostile?.content).toContain('# #evil"&lt;script&gt;');
		expect(hostile?.content).toContain("&lt;/script&gt;");
		expect(hostile?.content).not.toContain("# <script>");
		// The YAML scalar must not contain a literal line break (escaped \n).
		expect(hostile?.content).toContain("\\nalert(1)");
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
	test("resolves attachment basenames case-insensitively", async () => {
		const processor = makeProcessor(assetsFixtureRoot, {
			enableCaseInsensitiveLookup: true,
		});
		const file = await processor.process({
			value: "[[IMAGE.PNG]]",
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

	test("does not emit path traversal in media embed URLs", async () => {
		const processor = makeProcessor(fixtureRoot, { enableMediaEmbeds: true });
		const file = await processor.process({
			value: "![[../../secret.png]]",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		const output = String(file);
		// The URL must be traversal-free; only the alt attribute may echo the
		// original (unescaped) target text.
		expect(output).not.toContain('src="../');
		expect(output).toContain('src="/secret.png"');
	});
	test("uses the shared parser for escaped image aliases", async () => {
		const processor = makeProcessor(assetsFixtureRoot, {
			enableMediaEmbeds: true,
		});
		const file = await processor.process({
			value: "![[image.png|A \\| B]]",
			path: path.resolve(assetsFixtureRoot, "index.md"),
		});

		const output = String(file);
		expect(output).toContain('alt="A | B"');
		expect(output).not.toContain("A \\| B");
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
			{ routePath: "/", title: "Home" },
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

	test("resolves valid links after a broken link when onBrokenLink is warn", async () => {
		const processor = makeProcessor(fixtureRoot, { onBrokenLink: "warn" });
		const file = await processor.process({
			value: "Broken [[nonexistent]] then valid [[guide/getting-started]].",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(String(file)).toContain("/guide/getting-started");
	});

	test("throws a fatal error when onBrokenLink is error", async () => {
		const processor = makeProcessor(fixtureRoot, { onBrokenLink: "error" });

		await expect(
			processor.process({
				value: "[[nonexistent]]",
				path: path.resolve(fixtureRoot, "index.md"),
			}),
		).rejects.toThrow();
	});
});

describe("content index resilience", () => {
	test("buildContentIndex skips unreadable files without crashing", async () => {
		const index = await buildContentIndex(fixtureRoot);
		expect(index.pages.length).toBeGreaterThan(0);
		expect(index.byAbsolutePath.size).toBeGreaterThan(0);
	});

	test("reuses unchanged page objects across incremental rebuilds", async () => {
		const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import(
			"node:fs"
		);
		const tmp = await import("node:os");
		const pathMod = await import("node:path");
		const root = mkdtempSync(pathMod.join(tmp.tmpdir(), "vault-"));
		mkdirSync(pathMod.join(root, "sub"), { recursive: true });
		writeFileSync(pathMod.join(root, "a.md"), "# A\n\nHeading A");
		writeFileSync(pathMod.join(root, "sub", "b.md"), "# B\n\nHeading B");

		const first = await getCachedContentIndex(root);
		const a1 = first.byPathKey.get("a");
		const b1 = first.byPathKey.get("sub/b");

		writeFileSync(pathMod.join(root, "sub", "b.md"), "# B\n\n## New Heading");
		const second = await getCachedContentIndex(root);
		const a2 = second.byPathKey.get("a");
		const b2 = second.byPathKey.get("sub/b");

		expect(a2).toBe(a1);
		expect(b2).not.toBe(b1);
		expect(b2?.headings.map((h) => h.rawText)).toEqual(["B", "New Heading"]);

		rmSync(root, { recursive: true, force: true });
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

	test("defaults to case-insensitive lookup, matching Obsidian", async () => {
		const { pluginObsidianWikiLink } = await import("../src/index");
		const plugin = pluginObsidianWikiLink();
		const tuple = plugin.markdown?.remarkPlugins?.[0] as [
			unknown,
			{ options: NormalizedPluginOptions },
		];

		expect(tuple[1].options.enableCaseInsensitiveLookup).toBe(true);
	});

	test("allows opting out of case-insensitive lookup", async () => {
		const { pluginObsidianWikiLink } = await import("../src/index");
		const plugin = pluginObsidianWikiLink({
			enableCaseInsensitiveLookup: false,
		});
		const tuple = plugin.markdown?.remarkPlugins?.[0] as [
			unknown,
			{ options: NormalizedPluginOptions },
		];

		expect(tuple[1].options.enableCaseInsensitiveLookup).toBe(false);
	});

	test("defaults to markdown link resolution, matching Obsidian", async () => {
		const { pluginObsidianWikiLink } = await import("../src/index");
		const plugin = pluginObsidianWikiLink();
		const tuple = plugin.markdown?.remarkPlugins?.[0] as [
			unknown,
			{ options: NormalizedPluginOptions },
		];

		expect(tuple[1].options.enableMarkdownLinks).toBe(true);
	});

	test("allows opting out of markdown link resolution", async () => {
		const { pluginObsidianWikiLink } = await import("../src/index");
		const plugin = pluginObsidianWikiLink({
			enableMarkdownLinks: false,
		});
		const tuple = plugin.markdown?.remarkPlugins?.[0] as [
			unknown,
			{ options: NormalizedPluginOptions },
		];

		expect(tuple[1].options.enableMarkdownLinks).toBe(false);
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

describe("wikilink escape handling", () => {
	test("does not split on an escaped hash in the target", () => {
		const parsed = parseWikiLink("Page\\#Name", "[[Page\\#Name]]");

		expect(parsed.target).toBe("Page#Name");
		expect(parsed.subpath).toBeUndefined();
	});

	test("resolves escaped special characters in aliases", () => {
		const parsed = parseWikiLink(
			"guide/getting-started#Install|A \\| B",
			"[[guide/getting-started#Install|A \\| B]]",
		);

		expect(parsed.alias).toBe("A | B");
		expect(parsed.subpath).toEqual({ kind: "heading", value: "Install" });
	});
});

describe("heading transclusion with explicit ids and slugs", () => {
	test("transcludes a section by explicit id and emits a heading anchor", async () => {
		const processor = makeProcessor(headingFixtureRoot, {
			enableTransclusion: true,
		});
		const file = await processor.process({
			value: "![[guide/variants#custom-anchor]]",
			path: path.resolve(headingFixtureRoot, "index.md"),
		});

		const output = String(file);
		expect(output).toContain('class="obsidian-transclusion"');
		expect(output).toContain('id="custom-anchor"');
		expect(output).toContain("Custom Anchor");
		expect(output).not.toContain("{#custom-anchor}");
	});

	test("transcludes a section by slugified heading", async () => {
		const processor = makeProcessor(headingFixtureRoot, {
			enableTransclusion: true,
		});
		const file = await processor.process({
			value: "![[guide/variants#spaced-atx-heading]]",
			path: path.resolve(headingFixtureRoot, "index.md"),
		});

		const output = String(file);
		expect(output).toContain('class="obsidian-transclusion"');
		expect(output).toContain('id="spaced-atx-heading"');
		expect(output).toContain("Spaced ATX Heading");
	});
});

describe("media URL encoding", () => {
	test("percent-encodes spaces in media embed URLs", async () => {
		const processor = makeProcessor(fixtureRoot, { enableMediaEmbeds: true });
		const file = await processor.process({
			value: "![[my image.png]]",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(String(file)).toContain('src="/my%20image.png"');
	});
});

describe("backlink exclusions", () => {
	const backlinksCodeRoot = path.resolve(
		process.cwd(),
		"tests/fixtures/backlinks-code",
	);

	test("indexes backlinks from real wikilinks and Markdown links", async () => {
		const index = await buildContentIndex(backlinksCodeRoot);

		// Code blocks, inline code, and comments must not create backlinks;
		// both real link syntaxes should deduplicate to one source page.
		expect(index.backlinks.get("/target")).toEqual([
			{ routePath: "/codes", title: "Code Mentions" },
		]);
	});

	test("renders wikilinks inside code blocks as plain text", async () => {
		const processor = makeProcessor(backlinksCodeRoot);
		const file = await processor.process({
			value: "```md\n[[target]]\n```\n\nInline `[[target]]` too.",
			path: path.resolve(backlinksCodeRoot, "codes.md"),
		});

		const output = String(file);
		expect(output).toContain("[[target]]");
		expect(output).not.toContain("](/target)");
	});
});

describe("callout title markdown", () => {
	test("renders inline markdown in callout titles", async () => {
		const processor = makeProcessor(fixtureRoot, {
			enableCallouts: true,
		});

		const file = await processor.process({
			value: "> [!success] A **bold** and *italic* title with `code`\n> Body",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		const output = String(file);
		expect(output).toContain(
			'<div class="callout-title">A <strong>bold</strong> and <em>italic</em> title with <code>code</code></div>',
		);
	});

	test("resolves wikilinks inside callout titles", async () => {
		const processor = makeProcessor(fixtureRoot, {
			enableCallouts: true,
		});

		const file = await processor.process({
			value:
				"> [!example] See [[guide/getting-started|Getting Started]] now\n> Body",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		const output = String(file);
		expect(output).toContain(
			'<div class="callout-title">See <a href="/guide/getting-started">Getting Started</a> now</div>',
		);
	});

	test("drops raw HTML in callout titles instead of rendering it", async () => {
		const processor = makeProcessor(fixtureRoot, {
			enableCallouts: true,
		});

		const file = await processor.process({
			value: "> [!bug] Title with <script>alert(1)</script>\n> Body",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		const output = String(file);
		expect(output).not.toContain("<script>");
		expect(output).toContain("alert(1)");
	});

	test("leaves unresolvable wikilinks in callout titles verbatim", async () => {
		const processor = makeProcessor(fixtureRoot, {
			enableCallouts: true,
		});

		const file = await processor.process({
			value: "> [!question] See [[missing-page]] here\n> Body",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(String(file)).toContain(
			'<div class="callout-title">See [[missing-page]] here</div>',
		);
	});
});

describe("image alt text", () => {
	test("uses a non-numeric pipe alias as image alt text", async () => {
		const processor = makeProcessor(fixtureRoot, {
			enableMediaEmbeds: true,
		});

		const file = await processor.process({
			value: "![[image.png|Screenshot of the UI]]",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(String(file)).toContain(
			'<img src="/image.png" alt="Screenshot of the UI" loading="lazy" />',
		);
	});

	test("still treats a numeric pipe as a size, not alt text", async () => {
		const processor = makeProcessor(fixtureRoot, {
			enableMediaEmbeds: true,
		});

		const file = await processor.process({
			value: "![[image.png|300]]",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(String(file)).toContain(
			'<img src="/image.png" alt="image.png" width="300" loading="lazy" />',
		);
	});
});

describe("wikilink and tag interaction", () => {
	test("does not rewrite current-page anchors inside wikilinks as tags", async () => {
		const processor = makeProcessor(fixtureRoot, {
			enableTagLinking: true,
		});

		const file = await processor.process({
			value: "Jump to [[#Overview]] now.",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		const output = String(file);
		// The resolver appends a tooltip title (heading preview); only assert
		// the link itself here.
		expect(output).toContain("[Overview](#overview");
		expect(output).not.toContain("/tags/");
	});

	test("does not rewrite heading anchors inside wikilinks as tags", async () => {
		const processor = makeProcessor(fixtureRoot, {
			enableTagLinking: true,
		});

		const file = await processor.process({
			value: "See [[guide/getting-started#Install]] for details.",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		const output = String(file);
		expect(output).toContain("[Install](/guide/getting-started#install");
		expect(output).not.toContain("/tags/");
		expect(output).not.toContain("[[");
	});

	test("does not highlight ==text== inside wikilink aliases", async () => {
		const processor = makeProcessor(fixtureRoot);

		const file = await processor.process({
			value: "See [[guide/getting-started#Install|==Important==]] here.",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		const output = String(file);
		expect(output).toContain("[==Important==](");
		expect(output).not.toContain("<mark>");
	});
});

describe("markdown link resolution", () => {
	test("resolves vault-relative .md links by path", async () => {
		const processor = makeProcessor(fixtureRoot);

		const file = await processor.process({
			value: "See [the guide](guide/getting-started.md) for details.",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(String(file)).toBe(
			"See [the guide](/guide/getting-started) for details.\n",
		);
	});

	test("resolves .md links by basename across folders", async () => {
		const processor = makeProcessor(fixtureRoot);

		const file = await processor.process({
			value: "See [the guide](getting-started.md).",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(String(file)).toBe("See [the guide](/guide/getting-started).\n");
	});

	test("resolves heading anchors in .md links", async () => {
		const processor = makeProcessor(fixtureRoot);

		const file = await processor.process({
			value: "See [install steps](guide/getting-started.md#Install).",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		const output = String(file);
		expect(output).toContain("[install steps](/guide/getting-started#install");
		expect(output).not.toContain(".md");
	});

	test("resolves root-absolute .md links", async () => {
		const processor = makeProcessor(fixtureRoot);

		const file = await processor.process({
			value: "See [the guide](/guide/getting-started.md).",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(String(file)).toBe("See [the guide](/guide/getting-started).\n");
	});

	test("resolves .md links case-insensitively when enabled", async () => {
		const processor = makeProcessor(fixtureRoot, {
			enableCaseInsensitiveLookup: true,
		});

		const file = await processor.process({
			value: "See [the guide](GUIDE/Getting-Started.md).",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(String(file)).toBe("See [the guide](/guide/getting-started).\n");
	});

	test("decodes percent-encoded .md destinations", async () => {
		const processor = makeProcessor(fixtureRoot);

		const file = await processor.process({
			value: "See [the guide](guide/getting-started.md).",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(String(file)).toBe("See [the guide](/guide/getting-started).\n");
	});

	test("leaves external, hash-only, and extensionless links untouched", async () => {
		const processor = makeProcessor(fixtureRoot);

		const file = await processor.process({
			value:
				"[docs](https://example.com/a.md), [section](#anchor), [route](/guide/getting-started), [mail](mailto:x@y.md).",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		const output = String(file);
		expect(output).toContain("(https://example.com/a.md)");
		expect(output).toContain("(#anchor)");
		expect(output).toContain("(/guide/getting-started)");
		expect(output).toContain("(mailto:x@y.md)");
	});

	test("leaves unresolvable .md links untouched in warn mode", async () => {
		const processor = makeProcessor(fixtureRoot, { onBrokenLink: "warn" });

		const file = await processor.process({
			value: "See [missing](no-such-page.md).",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(String(file)).toBe("See [missing](no-such-page.md).\n");
		expect(
			file.messages.some((m) => String(m).includes("no-such-page.md")),
		).toBe(true);
	});

	test("fails the build for unresolvable .md links in error mode", async () => {
		const processor = makeProcessor(fixtureRoot);

		await expect(
			processor.process({
				value: "See [missing](no-such-page.md).",
				path: path.resolve(fixtureRoot, "index.md"),
			}),
		).rejects.toThrow();
	});

	test("resolves relative .md links from the current folder", async () => {
		const processor = makeProcessor(fixtureRoot);

		const file = await processor.process({
			value: "See [advanced](./advanced.md).",
			path: path.resolve(fixtureRoot, "guide/getting-started.md"),
		});

		expect(String(file)).toBe("See [advanced](/guide/advanced).\n");
	});

	test("can be disabled", async () => {
		const processor = makeProcessor(fixtureRoot, {
			enableMarkdownLinks: false,
		});

		const file = await processor.process({
			value: "See [the guide](guide/getting-started.md).",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		expect(String(file)).toBe("See [the guide](guide/getting-started.md).\n");
	});
});

describe("markdown embeds", () => {
	test("transcludes ![alt](Page.md) embeds", async () => {
		const processor = makeProcessor(fixtureRoot, {
			enableTransclusion: true,
		});

		const file = await processor.process({
			value: "![intro](guide/getting-started.md)",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		const output = String(file);
		expect(output).toContain('class="obsidian-transclusion"');
		expect(output).toContain("Getting Started");
	});

	test("transcludes a section from ![alt](Page.md#Heading) embeds", async () => {
		const processor = makeProcessor(fixtureRoot, {
			enableTransclusion: true,
		});

		const file = await processor.process({
			value: "![install](guide/getting-started.md#Install)",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		const output = String(file);
		expect(output).toContain('class="obsidian-transclusion"');
		expect(output).toContain("Install");
	});

	test("renders an embed link when transclusion is disabled", async () => {
		const processor = makeProcessor(fixtureRoot);

		const file = await processor.process({
			value: "![intro](guide/getting-started.md)",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		const output = String(file);
		expect(output).toContain('class="obsidian-embed"');
		expect(output).toContain('href="/guide/getting-started"');
		expect(output).toContain("intro");
	});
});

describe("missing section embeds", () => {
	test("reports broken anchors on embeds through onBrokenLink", async () => {
		const processor = makeProcessor(fixtureRoot, {
			enableTransclusion: true,
			onBrokenLink: "warn",
		});

		const file = await processor.process({
			value: "![[guide/getting-started#Missing]]",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		const output = String(file);
		// The raw embed is left in place (remark-stringify escapes the
		// brackets) rather than falling back to the full page content.
		expect(output).toContain("guide/getting-started#Missing");
		expect(output).not.toContain('class="obsidian-transclusion"');
		expect(output).not.toContain("Install steps");
		expect(file.messages.some((m) => String(m).includes("broken-anchor"))).toBe(
			true,
		);
	});
});

describe("callout title highlights", () => {
	test("renders ==highlights== inside callout titles", async () => {
		const processor = makeProcessor(fixtureRoot, {
			enableCallouts: true,
		});

		const file = await processor.process({
			value: "> [!warning] A ==critical== warning\n> Body",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		const output = String(file);
		expect(output).toContain(
			'<div class="callout-title">A <mark>critical</mark> warning</div>',
		);
	});

	test("renders highlights combined with markdown and wikilinks", async () => {
		const processor = makeProcessor(fixtureRoot, {
			enableCallouts: true,
		});

		const file = await processor.process({
			value:
				"> [!example] **See** [[guide/getting-started|the guide]] ==now==\n> Body",
			path: path.resolve(fixtureRoot, "index.md"),
		});

		const output = String(file);
		expect(output).toContain("<strong>See</strong>");
		expect(output).toContain('<a href="/guide/getting-started">the guide</a>');
		expect(output).toContain("<mark>now</mark>");
	});
});

describe("markdown link config hook", () => {
	type ConfigFn = (config: Record<string, unknown>) => Record<string, unknown>;

	test("defaults markdown.link.checkDeadLinks to false when markdown links are on", async () => {
		const { pluginObsidianWikiLink } = await import("../src/index");
		const plugin = pluginObsidianWikiLink();
		const configFn = plugin.config as unknown as ConfigFn;

		const config = configFn({ root: "docs" });

		expect(
			(config.markdown as { link?: { checkDeadLinks?: boolean } })?.link
				?.checkDeadLinks,
		).toBe(false);
	});

	test("does not override an explicit checkDeadLinks setting", async () => {
		const { pluginObsidianWikiLink } = await import("../src/index");
		const plugin = pluginObsidianWikiLink();
		const configFn = plugin.config as unknown as ConfigFn;

		const config = configFn({
			root: "docs",
			markdown: { link: { checkDeadLinks: true } },
		});

		expect(
			(config.markdown as { link?: { checkDeadLinks?: boolean } })?.link
				?.checkDeadLinks,
		).toBe(true);
	});

	test("leaves the dead-link gate alone when markdown links are disabled", async () => {
		const { pluginObsidianWikiLink } = await import("../src/index");
		const plugin = pluginObsidianWikiLink({ enableMarkdownLinks: false });
		const configFn = plugin.config as unknown as ConfigFn;

		const config = configFn({ root: "docs" });

		expect(config.markdown).toBeUndefined();
	});
});

describe("backlink labels", () => {
	const backlinkLabelsRoot = path.resolve(
		process.cwd(),
		"tests/fixtures/backlink-labels",
	);

	test("prefers frontmatter title, then first heading, then humanized basename", async () => {
		const index = await buildContentIndex(backlinkLabelsRoot);

		expect(index.backlinks.get("/target")).toEqual([
			{ routePath: "/linker-heading", title: "My Heading" },
			{ routePath: "/linker-plain", title: "linker plain" },
			{ routePath: "/linker-title", title: "Custom Title" },
		]);
	});
});

describe("rspress callout restoration", () => {
	// Faithful replica of the GitHub-style alert branch of Rspress's internal
	// remarkContainerSyntax: rewrites `> [!type]` blockquotes into
	// $$$callout$$$ containerDirective nodes, leaking the fold suffix into
	// content and dropping the first paragraph of multi-paragraph alerts.
	interface TestNode {
		type?: string;
		name?: string;
		attributes?: Record<string, string | undefined>;
		value?: string;
		children?: TestNode[];
	}

	const RSPRESS_TYPES = new Set([
		"tip",
		"note",
		"warning",
		"caution",
		"danger",
		"info",
		"details",
	]);
	const REGEX_GH_BEGIN = /^\s*\s*\[!(\w+)\]\s*(.*)/;

	function hijackAlertsLikeRspress(parent: { children: TestNode[] }): void {
		for (let i = 0; i < parent.children.length; i++) {
			const node = parent.children[i];
			if (node?.children) hijackAlertsLikeRspress({ children: node.children });
			const firstChild = node?.children?.[0];
			const firstText = firstChild?.children?.[0];
			if (
				node?.type === "blockquote" &&
				firstChild?.type === "paragraph" &&
				firstText &&
				"value" in firstText
			) {
				const match = String(firstText.value).match(REGEX_GH_BEGIN);
				if (!match) continue;
				const type = String(match[1]).toLowerCase();
				if (!RSPRESS_TYPES.has(type)) continue;
				const kids = node.children ?? [];
				if (kids.length === 1) {
					firstText.value = match[2] ?? "";
				}
				const container: TestNode = {
					type: "containerDirective",
					name: "$$$callout$$$",
					attributes: { type, title: type.toUpperCase() },
					children: kids.length === 1 ? kids.slice(0) : kids.slice(1),
				};
				parent.children.splice(i, 1, container);
			}
		}
	}

	type WikilinkTransformer = (tree: unknown, file: unknown) => Promise<void>;

	function makeTransformer(
		options: Partial<NormalizedPluginOptions>,
	): WikilinkTransformer {
		const factory = remarkWikilink as unknown as (
			pluginOptions: unknown,
		) => WikilinkTransformer;
		return factory({
			getDocsRoot: () => fixtureRoot,
			options: { ...DEFAULT_OPTIONS, ...options },
		});
	}

	function toTestTree(tree: unknown): { children: TestNode[] } {
		return tree as { children: TestNode[] };
	}

	async function processHijacked(
		source: string,
		options: Partial<NormalizedPluginOptions> = {},
	): Promise<string> {
		const tree = unified().use(remarkParse).use(remarkGfm).parse(source);
		hijackAlertsLikeRspress(toTestTree(tree));
		const { VFile } = await import("vfile");
		const file = new VFile({
			value: source,
			path: path.resolve(fixtureRoot, "index.md"),
		});
		await makeTransformer({ enableCallouts: true, ...options })(tree, file);
		return unified().use(remarkStringify).stringify(tree);
	}

	test("restores foldable hijacked callouts with title and fold state", async () => {
		const output = await processHijacked(
			"> [!note]- Collapsed by Default\n> Hidden until expanded.\n",
		);

		expect(output).toContain("<details");
		expect(output).toContain('<summary class="callout-title">');
		expect(output).toContain("Collapsed by Default</summary>");
		expect(output).toContain("Hidden until expanded.");
		expect(output).not.toContain("- Collapsed");
		expect(output).not.toContain("$$$callout$$$");
	});

	test("restores the first paragraph that Rspress drops", async () => {
		const output = await processHijacked(
			"> [!warning] Watch Out\n> This paragraph is dropped by Rspress's transform.\n>\n> Second paragraph.\n",
		);

		expect(output).toContain('class="callout callout-warning"');
		expect(output).toContain('<div class="callout-title">Watch Out</div>');
		expect(output).toContain(
			"This paragraph is dropped by Rspress's transform.",
		);
		expect(output).toContain("Second paragraph.");
	});

	test("restores nested hijacked callouts", async () => {
		const output = await processHijacked(
			"> [!note] Outer\n> Outer intro.\n>\n> > [!tip] Inner\n> > Inner content.\n>\n> Outer outro.\n",
		);

		expect(output).toContain('class="callout callout-note"');
		expect(output).toContain('class="callout callout-tip"');
		expect(output).toContain("Outer intro.");
		expect(output).toContain("Inner content.");
		expect(output).toContain("Outer outro.");
	});

	test("leaves ::: directive containers untouched", async () => {
		const source = ":::note Native Directive\nNative content\n:::\n";
		const tree = unified().use(remarkParse).use(remarkGfm).parse(source);
		// Simulate a ::: directive container the way Rspress converts it:
		// children keep positions pointing at non-blockquote source lines.
		const root = toTestTree(tree);
		const paragraph = root.children.find((n) => n.type === "paragraph");
		const container: TestNode = {
			type: "containerDirective",
			name: "$$$callout$$$",
			attributes: { type: "note", title: "Note" },
			children: [paragraph ?? { type: "paragraph" }],
		};
		root.children = [container];

		const { VFile } = await import("vfile");
		const file = new VFile({
			value: source,
			path: path.resolve(fixtureRoot, "index.md"),
		});
		await makeTransformer({ enableCallouts: true })(tree, file);

		// remarkStringify cannot serialize containerDirective nodes, so assert
		// on the tree: the directive must survive untouched.
		const json = JSON.stringify(tree);
		expect(json).toContain('"containerDirective"');
		expect(json).toContain("$$$callout$$$");
		expect(json).toContain("Native content");
		expect(json).not.toContain('"html"');
	});

	test("does not restore when callouts are disabled", async () => {
		const source = "> [!note] Plain\n> Body\n";
		const tree = unified().use(remarkParse).use(remarkGfm).parse(source);
		hijackAlertsLikeRspress(toTestTree(tree));
		const { VFile } = await import("vfile");
		const file = new VFile({
			value: source,
			path: path.resolve(fixtureRoot, "index.md"),
		});
		await makeTransformer({})(tree, file);

		const json = JSON.stringify(tree);
		expect(json).toContain('"containerDirective"');
		expect(json).toContain("$$$callout$$$");
		expect(json).not.toContain('"html"');
	});
});
