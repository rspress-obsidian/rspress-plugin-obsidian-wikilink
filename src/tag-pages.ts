import type { ContentIndex, ContentPage } from "./types.ts";

interface TagEntry {
	displayName: string;
	pages: ContentPage[];
}

const TAG_UNSAFE_CHARS = /[\s"<>#?%&]/g;

export function encodeTagPathSegment(tag: string): string {
	const encoded = tag.replace(TAG_UNSAFE_CHARS, (c) => encodeURIComponent(c));
	if (!encoded) {
		console.warn(
			`[rspress-plugin-obsidian-wikilink] Tag "${tag}" encoded to an empty path segment — skipping.`,
		);
	}
	return encoded;
}

/**
 * Collect unique tags from all pages, preserving the original casing of the
 * first occurrence. Deduplication is case-insensitive.
 *
 * Nested tags (e.g. "parent/child") also generate entries for every ancestor
 * segment ("parent"), mirroring Obsidian's tag hierarchy behaviour.
 */
function collectTags(index: ContentIndex): Map<string, TagEntry> {
	const tagMap = new Map<string, TagEntry>();

	const addTag = (tag: string, page: ContentPage) => {
		const key = tag.toLowerCase();
		const existing = tagMap.get(key);
		if (existing) {
			if (!existing.pages.includes(page)) {
				existing.pages.push(page);
			}
		} else {
			tagMap.set(key, { displayName: tag, pages: [page] });
		}
	};

	for (const page of index.pages) {
		for (const tag of page.tags) {
			addTag(tag, page);
			// Also generate parent segments for nested tags.
			const parts = tag.split("/");
			for (let depth = 1; depth < parts.length; depth++) {
				addTag(parts.slice(0, depth).join("/"), page);
			}
		}
	}

	return tagMap;
}

function escapeYamlDoubleQuoted(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r")
		.replace(/\t/g, "\\t");
}

/**
 * Escape a tag name for safe inclusion in a markdown heading. HTML special
 * characters are entity-escaped (the page renders with raw HTML enabled) and
 * link-label brackets are escaped so the tag cannot form a `[x](y)` link.
 */
function escapeHeadingText(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\[/g, "\\[")
		.replace(/\]/g, "\\]")
		.replace(/\n/g, " ")
		.replace(/\r/g, " ");
}

/**
 * Escape markdown link-label and destination syntax so a page `title`
 * containing `]`, `(`, or `)` cannot break out of the generated link.
 */
function escapeMarkdownLabel(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/[[\]]/g, "\\$&");
}

function escapeMarkdownDestination(value: string): string {
	return value.replace(/[()]/g, "\\$&").replace(/\s/g, "%20");
}

function generateTagPageContent(
	displayName: string,
	pages: ContentPage[],
): string {
	const listItems = pages
		.map((p) => {
			const label = escapeMarkdownLabel(p.title ?? p.baseName);
			const destination = escapeMarkdownDestination(p.routePath);
			return `- [${label}](${destination})`;
		})
		.join("\n");

	const escapedHeading = escapeHeadingText(displayName);
	return [
		"---",
		`title: "#${escapeYamlDoubleQuoted(displayName)}"`,
		"---",
		"",
		`# #${escapedHeading}`,
		"",
		listItems,
		"",
	].join("\n");
}

export interface AdditionalPage {
	routePath: string;
	content: string;
}

/**
 * Generate one AdditionalPage per unique tag found across all indexed pages.
 * Each page is served at /tags/{displayName} and lists all pages with that tag.
 */
export function generateTagPages(index: ContentIndex): AdditionalPage[] {
	const tagMap = collectTags(index);

	return [...tagMap.entries()]
		.filter(
			([, { displayName }]) => encodeTagPathSegment(displayName).length > 0,
		)
		.map(([, { displayName, pages }]) => ({
			routePath: `/tags/${encodeTagPathSegment(displayName)}`,
			content: generateTagPageContent(displayName, pages),
		}));
}
