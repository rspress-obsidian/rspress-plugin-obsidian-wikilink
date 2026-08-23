import path from "node:path";
import {
	humanizeBaseName,
	normalizeLookupValue,
	slugifyHeading,
} from "./slug.ts";
import type {
	ContentAsset,
	ContentPage,
	ParsedWikiLink,
	ResolveContext,
	ResolvedWikiLink,
	WikiSubpath,
} from "./types.ts";
import {
	encodeRoutePath,
	formatAvailableBlocks,
	formatAvailableHeadings,
	normalizeFilePathKey,
	resolveRelativePathKey,
} from "./utils.ts";
/**
 * Resolve a parsed wikilink against the content index, returning a
 * {@link ResolvedWikiLink} with either an `href` + `label` on success or
 * a diagnostic status + `message` on failure.
 *
 * Resolution order for non-current-page links:
 * 1. Exact path match
 * 2. Unique basename match
 * 3. Unique frontmatter title or alias match
 * 4. Case-insensitive path fallback (on by default; disable via
 *    {@link NormalizedPluginOptions.enableCaseInsensitiveLookup})
 * 5. Shortest-suffix fuzzy match (opt-in via
 *    {@link NormalizedPluginOptions.enableFuzzyMatching})
 */
export function resolveWikiLink(
	parsed: ParsedWikiLink,
	context: ResolveContext,
): ResolvedWikiLink {
	if (parsed.search) {
		return resolveVaultSearch(parsed, context);
	}

	if (parsed.isCurrentPageReference) {
		return resolveCurrentPageReference(context.currentPage, parsed);
	}

	if (parsed.target.trim().length === 0) {
		return {
			status: "broken-page",
			message: `Wikilink target is empty in ${parsed.raw}.`,
		};
	}

	const relativePathKey = resolveRelativePathKey(
		context.currentPage.relativePath,
		parsed.target,
	);
	if (relativePathKey !== undefined) {
		const relativePage = context.index.byFilePathKey.get(relativePathKey);
		if (relativePage) {
			return resolveAgainstPage(relativePage, parsed);
		}

		const relativeAsset = context.index.byAssetPath.get(relativePathKey);
		if (relativeAsset) {
			return resolveAgainstAsset(relativeAsset, parsed);
		}

		if (context.options?.enableCaseInsensitiveLookup) {
			const relativePageResolution = resolveCandidateSet(
				context.index.byFilePathKeyCI.get(relativePathKey.toLowerCase()) ?? [],
				parsed.target,
				"a more specific path",
			);
			if (relativePageResolution) {
				return relativePageResolution.kind === "resolved"
					? resolveAgainstPage(relativePageResolution.page, parsed)
					: relativePageResolution.result;
			}

			const relativeAssets =
				context.index.byAssetPathCI.get(relativePathKey.toLowerCase()) ?? [];
			if (relativeAssets.length === 1) {
				const asset = relativeAssets[0];
				if (asset) return resolveAgainstAsset(asset, parsed);
			}
			if (relativeAssets.length > 1) {
				return {
					status: "ambiguous-page",
					message: `Wikilink target "${parsed.target}" matches multiple attachments; use a case-sensitive path.`,
				};
			}
		}

		return {
			status: "broken-page",
			message: `Unable to resolve relative wikilink target "${parsed.target}" from ${context.currentPage.relativePath}.`,
		};
	}

	const exactPathKey = normalizeFilePathKey(parsed.target);
	const exactPage = context.index.byFilePathKey.get(exactPathKey);

	if (exactPage) {
		return resolveAgainstPage(exactPage, parsed);
	}
	const exactAsset = context.index.byAssetPath.get(exactPathKey);
	if (exactAsset) {
		return resolveAgainstAsset(exactAsset, parsed);
	}
	const assetBaseName = path.basename(exactPathKey);

	const assetCandidates =
		context.index.byAssetBaseName.get(assetBaseName) ?? [];
	if (assetCandidates.length === 1) {
		const asset = assetCandidates[0];
		if (asset) return resolveAgainstAsset(asset, parsed);
	}
	if (assetCandidates.length > 1) {
		return {
			status: "ambiguous-page",
			message: `Wikilink target "${parsed.target}" matches multiple attachments; use a path-qualified link.`,
		};
	}

	const exactBaseName = path.basename(exactPathKey);
	const exactBaseNameCandidates =
		context.index.byBaseName.get(exactBaseName) ?? [];
	const exactBaseNameResolution = resolveCandidateSet(
		exactBaseNameCandidates,
		parsed.target,
		"path-qualified link",
	);
	if (exactBaseNameResolution) {
		return exactBaseNameResolution.kind === "resolved"
			? resolveAgainstPage(exactBaseNameResolution.page, parsed)
			: exactBaseNameResolution.result;
	}

	const metadataCandidates = getMetadataCandidates(context, parsed.target);
	const metadataResolution = resolveCandidateSet(
		metadataCandidates,
		parsed.target,
		"a more specific filename",
	);
	if (metadataResolution) {
		return metadataResolution.kind === "resolved"
			? resolveAgainstPage(metadataResolution.page, parsed)
			: metadataResolution.result;
	}

	if (context.options?.enableCaseInsensitiveLookup) {
		const normalizedAssetTarget = exactPathKey.toLowerCase();
		const caseInsensitiveAssets = context.index.assets.filter(
			(asset) => asset.pathKey.toLowerCase() === normalizedAssetTarget,
		);
		const caseInsensitiveAssetBaseNameCandidates =
			context.index.byAssetBaseNameCI.get(assetBaseName.toLowerCase()) ?? [];
		const allCaseInsensitiveAssets =
			caseInsensitiveAssets.length > 0
				? caseInsensitiveAssets
				: caseInsensitiveAssetBaseNameCandidates;
		if (allCaseInsensitiveAssets.length === 1) {
			const asset = allCaseInsensitiveAssets[0];
			if (asset) return resolveAgainstAsset(asset, parsed);
		}
		if (allCaseInsensitiveAssets.length > 1) {
			return {
				status: "ambiguous-page",
				message: `Wikilink target "${parsed.target}" matches multiple attachments; use a case-sensitive path.`,
			};
		}
	}

	if (context.options?.enableCaseInsensitiveLookup) {
		const caseInsensitiveResolution = resolveCaseInsensitivePage(
			context,
			parsed.target,
		);
		if (caseInsensitiveResolution) {
			return caseInsensitiveResolution.kind === "resolved"
				? resolveAgainstPage(caseInsensitiveResolution.page, parsed)
				: caseInsensitiveResolution.result;
		}
	}

	if (context.options?.enableFuzzyMatching) {
		const fuzzyResolution = resolveFuzzyPage(context, parsed.target);
		if (fuzzyResolution) {
			return fuzzyResolution.kind === "resolved"
				? resolveAgainstPage(fuzzyResolution.page, parsed)
				: fuzzyResolution.result;
		}
	}

	return {
		status: "broken-page",
		message: `Unable to resolve wikilink target "${parsed.target}".`,
	};
}
function resolveVaultSearch(
	parsed: ParsedWikiLink,
	context: ResolveContext,
): ResolvedWikiLink {
	const query = parsed.subpath?.value.trim().toLowerCase() ?? "";
	if (!query || !parsed.search) {
		return {
			status: "broken-page",
			message: `Vault search target is empty in ${parsed.raw}.`,
		};
	}

	const matches: Array<{
		page: ContentPage;
		fragment: string;
		label: string;
		description?: string;
	}> = [];

	for (const page of context.index.pages) {
		if (parsed.search === "heading") {
			for (const heading of page.headings) {
				if (heading.rawText.toLowerCase().includes(query)) {
					matches.push({
						page,
						fragment: heading.explicitId ?? heading.slug,
						label: heading.rawText,
						description: heading.preview,
					});
				}
			}
		} else {
			for (const block of page.blocks) {
				if (block.id.toLowerCase().includes(query)) {
					matches.push({
						page,
						fragment: `^${block.id}`,
						label: `^${block.id}`,
					});
				}
			}
		}
	}

	if (matches.length === 0) {
		return {
			status: "broken-page",
			message: `Vault search target "${parsed.subpath?.value}" did not match any ${parsed.search}.`,
		};
	}
	if (matches.length > 1) {
		return {
			status: "ambiguous-page",
			message: `Vault search target "${parsed.subpath?.value}" matched multiple ${parsed.search} results.`,
		};
	}

	const match = matches[0];
	if (!match) {
		return {
			status: "broken-page",
			message: `Vault search target "${parsed.subpath?.value}" did not match any ${parsed.search}.`,
		};
	}

	return {
		status: "ok",
		href: `${encodeRoutePath(match.page.routePath)}#${match.fragment}`,
		label:
			parsed.alias ??
			(parsed.search === "block" ? match.label.slice(1) : match.label),
		description: match.description,
		targetPage: match.page,
	};
}

function resolveCurrentPageReference(
	page: ContentPage,
	parsed: ParsedWikiLink,
): ResolvedWikiLink {
	const subpath = parsed.subpath;
	if (!subpath?.value) {
		return {
			status: "broken-anchor",
			message: "Missing current-page anchor target.",
		};
	}

	const resolvedSubpath = resolveSubpath(page, subpath);
	if (!resolvedSubpath) {
		const suffix =
			subpath.kind === "heading"
				? formatAvailableHeadings(page)
				: formatAvailableBlocks(page);
		return {
			status: "broken-anchor",
			message: `Unable to resolve ${describeSubpath(subpath)} in ${page.relativePath}.${suffix}`,
		};
	}

	const description =
		subpath.kind === "heading"
			? (page.headingBySlug.get(resolvedSubpath)?.preview ??
				page.headingByText.get(normalizeLookupValue(subpath.value))?.preview)
			: undefined;

	return {
		status: "ok",
		href: `#${resolvedSubpath}`,
		label: parsed.alias ?? subpath.value,
		description,
		targetPage: page,
	};
}

function resolveAgainstPage(
	page: ContentPage,
	parsed: ParsedWikiLink,
): ResolvedWikiLink {
	const label = parsed.alias ?? defaultLabel(parsed, page);

	if (!parsed.subpath) {
		return {
			status: "ok",
			href: encodeRoutePath(page.routePath),
			label,
			targetPage: page,
		};
	}

	const resolvedSubpath = resolveSubpath(page, parsed.subpath);
	if (!resolvedSubpath) {
		const suffix =
			parsed.subpath.kind === "heading"
				? formatAvailableHeadings(page)
				: formatAvailableBlocks(page);
		return {
			status: "broken-anchor",
			message: `Unable to resolve ${describeSubpath(parsed.subpath)} in ${page.relativePath}.${suffix}`,
		};
	}

	// Look up heading preview for tooltip when the target includes a heading.
	const description =
		parsed.subpath?.kind === "heading"
			? (page.headingBySlug.get(resolvedSubpath)?.preview ??
				page.headingByText.get(normalizeLookupValue(parsed.subpath.value))
					?.preview)
			: undefined;

	return {
		status: "ok",
		href: `${encodeRoutePath(page.routePath)}#${resolvedSubpath}`,
		label,
		description,
		targetPage: page,
	};
}
function resolveAgainstAsset(
	asset: ContentAsset,
	parsed: ParsedWikiLink,
): ResolvedWikiLink {
	const fragment = parsed.subpath ? `#${parsed.subpath.value}` : "";
	return {
		status: "ok",
		href: `${asset.urlPath}${fragment}`,
		label: parsed.alias ?? humanizeBaseName(asset.baseName),
	};
}

function resolveSubpath(
	page: ContentPage,
	subpath: WikiSubpath,
): string | undefined {
	if (subpath.kind === "block") {
		return resolveBlockId(page, subpath.value);
	}

	return resolveHeadingSlug(page, subpath.value);
}

export function resolveHeadingSlug(
	page: ContentPage,
	anchor: string,
): string | undefined {
	const headingParts = anchor
		.split("#")
		.map((part) => part.trim())
		.filter(Boolean);
	const lookupAnchor = headingParts.at(-1) ?? anchor;
	const normalizedAnchor = normalizeLookupValue(lookupAnchor);

	// Attempt 1: explicit heading ID match — O(1) via pre-computed map.
	const explicitEntry =
		page.headingBySlug.get(lookupAnchor) ??
		page.headingBySlug.get(normalizedAnchor);
	if (explicitEntry?.explicitId) {
		return explicitEntry.explicitId;
	}

	const slugifiedAnchor = slugifyHeading(lookupAnchor);
	// Attempt 2: slug match — O(1) via pre-computed map.
	const slugEntry = page.headingBySlug.get(slugifiedAnchor);
	if (slugEntry) {
		return slugEntry.explicitId ?? slugEntry.slug;
	}

	// Attempt 3: raw text match — O(1) via pre-computed map.
	const textEntry = page.headingByText.get(normalizedAnchor);
	if (textEntry) {
		return textEntry.explicitId ?? textEntry.slug;
	}

	// Attempt 4: emoji-preserving slug prefix fallback.
	// Obsidian may preserve emoji in heading IDs, but github-slugger strips
	// them, so the slugged anchor may be a prefix of the stored slug.
	for (const heading of page.headings) {
		if (heading.slug.startsWith(`${slugifiedAnchor}-`)) {
			return heading.explicitId ?? heading.slug;
		}
	}

	// Attempt 5: case-insensitive substring match (for Unicode headings).
	for (const heading of page.headings) {
		if (heading.rawText.toLowerCase().includes(lookupAnchor.toLowerCase())) {
			return heading.explicitId ?? heading.slug;
		}
	}

	return undefined;
}

function resolveBlockId(
	page: ContentPage,
	blockId: string,
): string | undefined {
	const normalizedBlockId = normalizeLookupValue(blockId);

	for (const block of page.blocks) {
		if (normalizeLookupValue(block.id) === normalizedBlockId) {
			return `^${block.id}`;
		}
	}

	return undefined;
}

function defaultLabel(parsed: ParsedWikiLink, page: ContentPage): string {
	if (parsed.subpath) {
		return parsed.subpath.value;
	}

	const normalizedTarget = normalizeLookupValue(parsed.target);
	if (
		(page.title && normalizeLookupValue(page.title) === normalizedTarget) ||
		page.aliases.some(
			(alias) => normalizeLookupValue(alias) === normalizedTarget,
		)
	) {
		return parsed.target.trim();
	}

	if (page.baseName.length > 0) {
		return humanizeBaseName(page.baseName);
	}

	return parsed.target;
}

function getMetadataCandidates(
	context: ResolveContext,
	target: string,
): ContentPage[] {
	const normalizedTarget = normalizeLookupValue(target);
	if (!normalizedTarget) {
		return [];
	}

	const deduped = new Map<string, ContentPage>();
	for (const page of context.index.byTitle.get(normalizedTarget) ?? []) {
		deduped.set(page.absolutePath, page);
	}
	for (const page of context.index.byAlias.get(normalizedTarget) ?? []) {
		deduped.set(page.absolutePath, page);
	}

	return [...deduped.values()];
}

function resolveCandidateSet(
	candidates: ContentPage[],
	target: string,
	instruction: string,
):
	| { kind: "resolved"; page: ContentPage }
	| { kind: "result"; result: ResolvedWikiLink }
	| undefined {
	if (candidates.length === 0) {
		return undefined;
	}

	if (candidates.length > 1) {
		return {
			kind: "result",
			result: {
				status: "ambiguous-page",
				message: `Wikilink target "${target}" is ambiguous; use ${instruction} instead.`,
			},
		};
	}

	const [candidate] = candidates;
	if (!candidate) {
		return undefined;
	}

	return {
		kind: "resolved",
		page: candidate,
	};
}

function resolveFuzzyPage(
	context: ResolveContext,
	target: string,
):
	| { kind: "resolved"; page: ContentPage }
	| { kind: "result"; result: ResolvedWikiLink }
	| undefined {
	const normalizedTarget = normalizeFuzzyLookup(target);
	if (!normalizedTarget) {
		return undefined;
	}
	const suffixMatches = context.index.pages.filter((page) => {
		const normalizedPagePath = normalizeFuzzyLookup(page.filePathKey);
		return (
			normalizedPagePath === normalizedTarget ||
			normalizedPagePath.endsWith(`/${normalizedTarget}`)
		);
	});

	if (suffixMatches.length === 0) {
		return undefined;
	}

	const sortedMatches = [...suffixMatches].sort(
		(left, right) => left.filePathKey.length - right.filePathKey.length,
	);
	const bestMatch = sortedMatches[0];
	const secondMatch = sortedMatches[1];

	if (!bestMatch) {
		return undefined;
	}

	if (
		secondMatch &&
		secondMatch.filePathKey.length === bestMatch.filePathKey.length
	) {
		return {
			kind: "result",
			result: {
				status: "ambiguous-page",
				message: `Fuzzy wikilink target "${target}" matched multiple pages; use a more specific path instead.`,
			},
		};
	}

	return {
		kind: "resolved",
		page: bestMatch,
	};
}

function resolveCaseInsensitivePage(
	context: ResolveContext,
	target: string,
):
	| { kind: "resolved"; page: ContentPage }
	| { kind: "result"; result: ResolvedWikiLink }
	| undefined {
	const normalizedTarget = normalizeFilePathKey(target).toLowerCase();
	if (!normalizedTarget) {
		return undefined;
	}

	const pathCandidates = context.index.byFilePathKeyCI.get(normalizedTarget);
	if (pathCandidates) {
		return resolveCandidateSet(pathCandidates, target, "a more specific path");
	}

	const baseName = path.basename(normalizedTarget);
	const baseCandidates = context.index.byBaseNameCI.get(baseName);
	return resolveCandidateSet(
		baseCandidates ?? [],
		target,
		"a path-qualified link",
	);
}
function normalizeFuzzyLookup(input: string): string {
	return normalizeFilePathKey(input).toLowerCase();
}

function describeSubpath(subpath: WikiSubpath): string {
	if (subpath.kind === "block") {
		return `block reference "^${subpath.value}"`;
	}

	return `anchor "${subpath.value}"`;
}
