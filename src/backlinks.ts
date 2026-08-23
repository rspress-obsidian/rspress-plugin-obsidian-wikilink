import path from "node:path";
import { normalizeLookupValue } from "./slug.ts";
import type { BacklinkRef, ContentIndex, ContentPage } from "./types.ts";
import {
	backlinkLabel,
	normalizeFilePathKey,
	resolveRelativePathKey,
} from "./utils.ts";

export type { BacklinkRef };

/**
 * Return the backlinks index for the given content index.
 *
 * Backlinks are now built during content indexing (see `buildContentIndex`)
 * rather than as a separate pass, so this is a simple property access.
 * The WeakMap cache here allows code that constructs a ContentIndex manually
 * (without going through `buildContentIndex`) to still get cached results.
 */
const manualBacklinksCache = new WeakMap<
	ContentIndex,
	Map<string, BacklinkRef[]>
>();

export async function getCachedBacklinksIndex(
	index: ContentIndex,
): Promise<Map<string, BacklinkRef[]>> {
	if (index.backlinks.size > 0 || index.pages.length === 0) {
		return index.backlinks;
	}

	const cached = manualBacklinksCache.get(index);
	if (cached) return cached;

	const result = await buildBacklinksIndex(index);
	manualBacklinksCache.set(index, result);
	return result;
}

/**
 * Build a map from each page's routePath to the list of pages that link to it.
 *
 * Uses pre-extracted wikilink targets (collected during content indexing) to
 * skip regex scanning entirely — reduces per-page cost to just one Map lookup
 * and a few O(1) resolution calls.
 *
 * Falls back to rawContentByPath for pages indexed before the wikilinkTargets
 * field was added (e.g. during a version upgrade).
 */
export async function buildBacklinksIndex(
	index: ContentIndex,
): Promise<Map<string, BacklinkRef[]>> {
	const backlinks = new Map<string, BacklinkRef[]>();

	for (const page of index.pages) {
		const targets = page.wikilinkTargets;

		for (const normalizedTarget of targets) {
			const resolved = resolveBacklinkTarget(index, normalizedTarget, page);
			for (const candidate of resolved) {
				if (candidate.absolutePath === page.absolutePath) continue;
				addBacklink(backlinks, candidate.routePath, page);
			}
		}
	}

	return backlinks;
}

/**
 * Resolve a wikilink target to candidate pages using the index maps.
 * Returns a deduplicated array of matching pages.
 */
function resolveBacklinkTarget(
	index: ContentIndex,
	normalizedTarget: string,
	sourcePage: ContentPage,
): ContentPage[] {
	const seen = new Set<string>();
	const results: ContentPage[] = [];

	const addPage = (page: ContentPage) => {
		if (!seen.has(page.absolutePath)) {
			seen.add(page.absolutePath);
			results.push(page);
		}
	};

	// Explicitly relative targets are resolved from the source page, just as
	// normal wikilink navigation does. A missing relative target must not fall
	// through to a global basename/title/alias match.
	const relativePathKey = resolveRelativePathKey(
		sourcePage.relativePath,
		normalizedTarget,
	);
	if (relativePathKey !== undefined) {
		const relativeCandidates = index.byFilePathKeyCI.get(
			relativePathKey.toLowerCase(),
		);
		for (const page of relativeCandidates ?? []) {
			addPage(page);
		}
		return results;
	}

	// Try exact vault-path lookup. The target was already lowercased for
	// deduplication, so the case-insensitive map handles mixed-case paths.
	const pathKey = normalizeFilePathKey(normalizedTarget).toLowerCase();
	const exactCandidates = index.byFilePathKeyCI.get(pathKey);
	if (exactCandidates) {
		for (const page of exactCandidates) {
			addPage(page);
		}
		return results;
	}
	// Try basename lookup.
	const baseName = path.basename(pathKey) || pathKey;
	const baseNameCandidates = index.byBaseName.get(baseName);
	if (baseNameCandidates) {
		for (const page of baseNameCandidates) {
			addPage(page);
		}
	}

	// Also try case-insensitive basename as fallback.
	if (results.length === 0) {
		const ciBaseCandidates = index.byBaseNameCI.get(baseName);
		if (ciBaseCandidates) {
			for (const page of ciBaseCandidates) {
				addPage(page);
			}
		}
	}
	// Frontmatter title and alias lookups (whitespace-normalized).
	if (results.length === 0) {
		const folded = normalizeLookupValue(normalizedTarget);
		for (const page of index.byTitle.get(folded) ?? []) {
			addPage(page);
		}
		for (const page of index.byAlias.get(folded) ?? []) {
			addPage(page);
		}
	}

	return results;
}

function addBacklink(
	backlinks: Map<string, BacklinkRef[]>,
	targetRoutePath: string,
	sourcePage: ContentPage,
): void {
	const existing = backlinks.get(targetRoutePath) ?? [];
	const already = existing.some((e) => e.routePath === sourcePage.routePath);
	if (!already) {
		existing.push({
			routePath: sourcePage.routePath,
			title: backlinkLabel(sourcePage),
		});
		backlinks.set(targetRoutePath, existing);
	}
}

/**
 * Render a backlinks panel as raw HTML. Returns the empty string when
 * there are no refs so the caller can unconditionally append the result.
 * The output is wrapped in `<div class="obsidian-backlinks">` and uses the
 * `.obsidian-backlinks` selectors in the bundled stylesheet.
 */
export function renderBacklinksHtml(refs: BacklinkRef[]): string {
	if (refs.length === 0) return "";
	const items = refs
		.map(
			(r) =>
				`<li><a href="${escapeHtmlAttribute(r.routePath)}">${escapeHtmlText(r.title)}</a></li>`,
		)
		.join("\n");
	return `<div class="obsidian-backlinks">\n<h2>Backlinks</h2>\n<ul>\n${items}\n</ul>\n</div>`;
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
