import type { ParsedWikiLink, WikilinkMatch } from "./types.ts";

const WIKILINK_PATTERN = /!?\[\[([^[\]]+?)\]\]/g;

// Characters that can be backslash-escaped inside a wikilink target or alias.
const UNESCAPE_PATTERN = /\\([|#^[\]])/g;

/**
 * Return the index of the first unescaped occurrence of `delimiter` in
 * `input`, or -1. A backslash escapes the immediately following character,
 * so `\|` does not terminate a pipe split and `\#` does not start an anchor.
 */
function findUnescaped(input: string, delimiter: string): number {
	for (let i = 0; i < input.length; i++) {
		const char = input[i];
		if (char === "\\") {
			i++; // skip the escaped character
			continue;
		}
		if (char === delimiter) {
			return i;
		}
	}
	return -1;
}

/**
 * Resolve backslash escapes for wikilink-special characters (`\|`, `\#`,
 * `\^`, `\[`, `\]`) in a target or alias segment.
 */
function unescapeWikilink(input: string): string {
	return input.replace(UNESCAPE_PATTERN, "$1");
}

/**
 * Find every `[[...]]` and `![[...]]` occurrence in `input`, returning their
 * positions and raw contents. Does not parse the inner target/alias/anchor
 * structure — use {@link parseWikiLink} for that.
 */
export function findWikilinkMatches(input: string): WikilinkMatch[] {
	const matches: WikilinkMatch[] = [];

	for (const match of input.matchAll(WIKILINK_PATTERN)) {
		const fullMatch = match[0];
		const inner = match[1];
		const start = match.index ?? -1;

		if (start < 0 || typeof inner !== "string") {
			continue;
		}

		matches.push({
			fullMatch,
			inner,
			start,
			end: start + fullMatch.length,
		});
	}

	return matches;
}

/**
 * Parse the inner body of a single wikilink into its constituent pieces.
 *
 * @param inner - The text between `[[` and `]]` (without delimiters).
 * @param raw - The full original match (e.g. `[[Page#Heading|Alias]]` or
 *   `![[image.png|300x200]]`), used to detect the embed prefix and to round-trip
 *   the source verbatim when resolution fails.
 */
export function parseWikiLink(inner: string, raw: string): ParsedWikiLink {
	const isEmbed = raw.startsWith("![[");
	const pipeIndex = findUnescaped(inner, "|");
	const targetAndAnchor = pipeIndex >= 0 ? inner.slice(0, pipeIndex) : inner;
	const alias =
		pipeIndex >= 0
			? unescapeWikilink(inner.slice(pipeIndex + 1)).trim() || undefined
			: undefined;

	const searchInput = targetAndAnchor.trim();
	const search = searchInput.startsWith("##")
		? "heading"
		: searchInput.startsWith("^^")
			? "block"
			: undefined;
	if (search) {
		return {
			raw,
			target: "",
			alias,
			isEmbed,
			subpath: {
				kind: search,
				value: unescapeWikilink(searchInput.slice(2)).trim(),
			},
			search,
			isCurrentPageReference: false,
		};
	}

	const hashIndex = findUnescaped(targetAndAnchor, "#");
	const target = unescapeWikilink(
		hashIndex >= 0 ? targetAndAnchor.slice(0, hashIndex) : targetAndAnchor,
	).trim();
	const anchor =
		hashIndex >= 0
			? unescapeWikilink(targetAndAnchor.slice(hashIndex + 1)).trim() ||
				undefined
			: undefined;
	const subpath = anchor
		? anchor.startsWith("^")
			? { kind: "block" as const, value: anchor.slice(1).trim() }
			: { kind: "heading" as const, value: anchor }
		: undefined;

	return {
		raw,
		target,
		alias,
		isEmbed,
		subpath,
		isCurrentPageReference:
			target.length === 0 && typeof subpath !== "undefined",
	};
}
