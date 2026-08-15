#!/usr/bin/env bun
// Regenerates the callout icon CSS block embedded in src/styles.css.
// Run via `bun scripts/generate-icons.ts` whenever icon mappings change.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as lucide from "lucide-static";

const ROOT = path.resolve(import.meta.dir, "..");
const STYLES_PATH = path.join(ROOT, "src", "styles.css");

// Canonical callout type → lucide icon export name.
const ICON_MAP: Record<string, string> = {
	note: "Pencil",
	tip: "Lightbulb",
	info: "Info",
	success: "CircleCheck",
	question: "CircleHelp",
	warning: "TriangleAlert",
	caution: "CircleAlert",
	danger: "OctagonAlert",
	failure: "XCircle",
	bug: "Bug",
	example: "FlaskConical",
	abstract: "List",
	quote: "Quote",
};

const START_MARKER = "/* ── CALL OUT ICONS (generated) ── */";
const END_MARKER = "/* ── END CALL OUT ICONS ── */";

function toDataUri(svg: string): string {
	// lucide ships `stroke="currentColor"`; as a CSS mask the alpha channel is
	// what matters, so the colour is irrelevant and dark mode inherits freely.
	const minimal = svg
		.replace(/\s+/g, " ")
		.replace(/ class="[^"]*"/, "")
		.replace(/ xmlns="[^"]*"/, "")
		.replace(/ width="[^"]*"/, "")
		.replace(/ height="[^"]*"/, "")
		.trim();
	return `url("data:image/svg+xml,${encodeURIComponent(minimal)}")`;
}

function buildBlock(): string {
	const lines: string[] = [START_MARKER];
	for (const [type, iconName] of Object.entries(ICON_MAP)) {
		const svg = (lucide as Record<string, unknown>)[iconName];
		if (typeof svg !== "string") {
			throw new Error(`lucide-static export ${iconName} not found`);
		}
		lines.push(`.callout-${type},\n.rp-callout--${type} {`);
		lines.push(`\t--callout-icon: ${toDataUri(svg)};`);
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
		styles.slice(0, start) + buildBlock() + styles.slice(end + END_MARKER.length);
} else {
	next = `${styles}\n\n${buildBlock()}\n`;
}

writeFileSync(STYLES_PATH, next);
console.log("  generated callout icons in src/styles.css");
