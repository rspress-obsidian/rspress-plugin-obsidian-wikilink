import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const DOC_BUILD = path.resolve(import.meta.dir, "../doc_build");
const GUIDE_DIR = path.join(DOC_BUILD, "guide");
const TAGS_DIR = path.join(DOC_BUILD, "tags");

// Verifies the full Rspress build pipeline end-to-end. Requires a docs build
// first (`bun run docs:build`); CI runs this file in the docs job after
// building. Skips with a notice when no build output exists so a plain
// `bun test` stays green without a docs build.
const hasBuildOutput = fs.existsSync(path.join(DOC_BUILD, "index.html"));
if (!hasBuildOutput) {
	console.info(
		"[integration] doc_build/ not found — run `bun run docs:build` to enable rspress build integration tests.",
	);
}

describe.skipIf(!hasBuildOutput)("rspress build integration", () => {
	test("build output directory exists with expected pages", () => {
		expect(fs.existsSync(DOC_BUILD)).toBe(true);
		expect(fs.existsSync(GUIDE_DIR)).toBe(true);
		expect(fs.existsSync(TAGS_DIR)).toBe(true);
	});

	test("index page has resolved wikilinks", () => {
		const html = fs.readFileSync(path.join(DOC_BUILD, "index.html"), "utf-8");
		expect(html).toContain("/guide/getting-started");
		expect(html).toContain("/guide/examples");
	});

	test("markdown links to vault pages are resolved", () => {
		const html = fs.readFileSync(
			path.join(GUIDE_DIR, "examples.html"),
			"utf-8",
		);
		expect(html).toContain(">Markdown link to the guide</a>");
		expect(html).toContain(">Markdown link to the vault root</a>");
		expect(html).toContain(">Markdown link with an anchor</a>");
		expect(html).not.toContain(".md)");
	});

	test("guide pages have resolved heading anchors", () => {
		const html = fs.readFileSync(
			path.join(GUIDE_DIR, "getting-started.html"),
			"utf-8",
		);
		expect(html).toContain('href="#install"');
	});

	test("backlinks panel is rendered", () => {
		const html = fs.readFileSync(
			path.join(GUIDE_DIR, "advanced.html"),
			"utf-8",
		);
		expect(html).toContain('class="obsidian-backlinks"');
	});

	test("callouts are transformed to styled divs for plugin-owned types", () => {
		const html = fs.readFileSync(
			path.join(GUIDE_DIR, "examples.html"),
			"utf-8",
		);
		expect(html).toContain('class="callout callout-success"');
		expect(html).toContain('class="callout callout-question"');
		expect(html).toContain('class="callout callout-example"');
		expect(html).toContain('class="callout callout-failure"');
	});

	test("callouts claimed by Rspress's built-in alert transform are restored", () => {
		const html = fs.readFileSync(
			path.join(GUIDE_DIR, "examples.html"),
			"utf-8",
		);
		// note/tip/warning/danger/info are hijacked by Rspress before plugin
		// remark plugins run; the plugin restores and renders them itself.
		expect(html).toContain('class="callout callout-note"');
		expect(html).toContain('class="callout callout-tip"');
		expect(html).toContain('class="callout callout-warning"');
		expect(html).toContain('class="callout callout-danger"');
		expect(html).toContain('class="callout callout-info"');
		expect(html).not.toContain("$$$callout$$$");
	});

	test("restored foldable callouts keep their title and first paragraph", () => {
		const html = fs.readFileSync(
			path.join(GUIDE_DIR, "examples.html"),
			"utf-8",
		);
		// Rspress's conversion leaks the fold suffix and drops the first
		// paragraph; both must survive the restoration.
		expect(html).toContain(
			'<details class="callout callout-note" data-callout="note">',
		);
		expect(html).toContain("Collapsed by Default</summary>");
		expect(html).toContain(
			"This content is hidden until the user expands the callout.",
		);
		expect(html).toContain(
			'<details class="callout callout-tip" data-callout="tip" open',
		);
		expect(html).toContain("Expanded by Default</summary>");
	});

	test("foldable callouts render as details elements", () => {
		const html = fs.readFileSync(
			path.join(GUIDE_DIR, "examples.html"),
			"utf-8",
		);
		expect(html).toContain("<details");
		expect(html).toMatch(/<summary class="callout-title">/);
	});

	test("callout titles render inline markdown", () => {
		const html = fs.readFileSync(
			path.join(GUIDE_DIR, "examples.html"),
			"utf-8",
		);
		expect(html).toContain(
			'<div class="callout-title">A <strong>bold</strong> title linking to',
		);
	});

	test("transclusion is rendered", () => {
		const html = fs.readFileSync(
			path.join(GUIDE_DIR, "examples.html"),
			"utf-8",
		);
		expect(html).toContain('class="obsidian-transclusion"');
	});

	test("tag pages are generated", () => {
		expect(fs.existsSync(path.join(TAGS_DIR, "demo.html"))).toBe(true);
		expect(fs.existsSync(path.join(TAGS_DIR, "examples.html"))).toBe(true);
	});

	test("generated tag page lists linked pages", () => {
		const html = fs.readFileSync(path.join(TAGS_DIR, "demo.html"), "utf-8");
		expect(html).toContain("/guide/examples");
	});

	test("highlights are transformed to mark tags", () => {
		const html = fs.readFileSync(
			path.join(GUIDE_DIR, "examples.html"),
			"utf-8",
		);
		expect(html).toContain("<mark>");
	});

	test("footnotes are rendered", () => {
		const html = fs.readFileSync(
			path.join(GUIDE_DIR, "examples.html"),
			"utf-8",
		);
		expect(html).toContain('class="footnote-ref"');
	});

	test("no stray empty paragraphs remain after transforms", () => {
		const html = fs.readFileSync(
			path.join(GUIDE_DIR, "examples.html"),
			"utf-8",
		);
		expect(html).not.toContain("<p></p>");
	});
});
