#!/usr/bin/env bun
// Regenerates the callout icon CSS block embedded in src/styles.css.
// Run via `bun scripts/generate-icons.ts` whenever icon mappings change.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const STYLES_PATH = path.join(ROOT, "src", "styles.css");

// Stable, CSP-safe callout glyphs. CSS data-URI masks are not rendered by
// every documentation host, so these use ordinary text content instead.
const ICON_MAP: Record<string, string> = {
	note: "✎",
	tip: "✦",
	info: "i",
	success: "✓",
	question: "?",
	warning: "!",
	caution: "!",
	danger: "!",
	failure: "×",
	bug: "⌁",
	example: "◇",
	abstract: "≡",
	quote: "❝",
};

const START_MARKER = "/* ── CALL OUT ICONS (generated) ── */";
const END_MARKER = "/* ── END CALL OUT ICONS ── */";

function buildBlock(): string {
	const lines: string[] = [START_MARKER];
	for (const [type, glyph] of Object.entries(ICON_MAP)) {
		lines.push(
			`.callout-${type} .callout-title::before,\n.rp-callout--${type} .rp-callout__title::before {`,
		);
		lines.push(`\tcontent: "${glyph}";`);
		lines.push("\tbackground: none;");
		lines.push("\tcolor: var(--callout-color, currentColor);");
		lines.push("\tfont-size: 1rem;");
		lines.push("\tfont-weight: 800;");
		lines.push("\tline-height: 1.1rem;");
		lines.push("\ttext-align: center;");
		lines.push("\tmask: none;");
		lines.push("\t-webkit-mask: none;");
		lines.push("}");
	}
	lines.push(END_MARKER);
	return lines.join("\n");
}

const styles = readFileSync(STYLES_PATH, "utf8");
const start = styles.indexOf(START_MARKER);
const end = styles.indexOf(END_MARKER);

let next: string;
if (start !== -1 && end !== -1) {
	next =
		styles.slice(0, start) +
		buildBlock() +
		styles.slice(end + END_MARKER.length);
} else {
	next = `${styles}\n\n${buildBlock()}\n`;
}

writeFileSync(STYLES_PATH, next);
console.log("  generated callout icons in src/styles.css");
