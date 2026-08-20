import type { ContentPage } from "./types.ts";

export interface DailyNoteConfig {
	folder: string;
	dateFormat: string;
	navigation: boolean;
}

const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];
const WEEKDAYS = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];
const TOKEN_PATTERN = /YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd/g;

export function normalizeDailyNoteConfig(
	config?: Partial<DailyNoteConfig>,
): DailyNoteConfig {
	return {
		folder: config?.folder?.replace(/^\/|\/$/g, "") ?? "",
		dateFormat: config?.dateFormat ?? "YYYY-MM-DD",
		navigation: config?.navigation ?? true,
	};
}

export function parseDailyNoteDate(
	relativePath: string,
	config: DailyNoteConfig,
): Date | undefined {
	const withoutExtension = relativePath.replace(/\.(md|mdx)$/i, "");
	const folderPrefix = config.folder ? `${config.folder}/` : "";
	if (folderPrefix && !withoutExtension.startsWith(folderPrefix))
		return undefined;
	const candidate = withoutExtension.slice(folderPrefix.length);
	const tokenMatches = [...config.dateFormat.matchAll(TOKEN_PATTERN)];
	let pattern = "";
	let cursor = 0;
	for (const match of tokenMatches) {
		pattern += escapeRegex(config.dateFormat.slice(cursor, match.index));
		pattern += tokenRegex(match[0] ?? "");
		cursor = (match.index ?? 0) + (match[0]?.length ?? 0);
	}
	pattern += escapeRegex(config.dateFormat.slice(cursor));
	const match = new RegExp(`^${pattern}$`).exec(candidate);
	if (!match) return undefined;

	let capture = 1;
	let year = 1970;
	let month = 1;
	let day = 1;
	for (const token of tokenMatches.map((item) => item[0] ?? "")) {
		const value = match[capture++] ?? "";
		if (token === "YYYY") year = Number(value);
		else if (token === "YY") year = 2000 + Number(value);
		else if (token === "MM" || token === "M") month = Number(value);
		else if (token === "DD" || token === "D") day = Number(value);
	}
	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		return undefined;
	}
	return date;
}

export function formatDailyNoteDate(date: Date, format: string): string {
	const replacements: Record<string, string> = {
		YYYY: String(date.getUTCFullYear()).padStart(4, "0"),
		YY: String(date.getUTCFullYear()).slice(-2),
		MMMM: MONTHS[date.getUTCMonth()] ?? "",
		MMM: (MONTHS[date.getUTCMonth()] ?? "").slice(0, 3),
		MM: String(date.getUTCMonth() + 1).padStart(2, "0"),
		M: String(date.getUTCMonth() + 1),
		DD: String(date.getUTCDate()).padStart(2, "0"),
		D: String(date.getUTCDate()),
		dddd: WEEKDAYS[date.getUTCDay()] ?? "",
		ddd: (WEEKDAYS[date.getUTCDay()] ?? "").slice(0, 3),
	};
	return format.replace(TOKEN_PATTERN, (token) => replacements[token] ?? token);
}

export function expandDailyTemplateText(value: string, date: Date): string {
	return value.replace(
		/\{\{date(?:(:([^}]+))|([+-])(\d+)([dwmy]))?\}\}/gi,
		(
			_match,
			_formatMarker: string,
			format: string | undefined,
			sign: string | undefined,
			amount: string | undefined,
			unit: string | undefined,
		) => {
			const adjusted = adjustDate(date, sign, amount, unit);
			return formatDailyNoteDate(adjusted, format || "YYYY-MM-DD");
		},
	);
}

export function renderDailyNavigation(
	currentPage: ContentPage,
	pages: ContentPage[],
	config: DailyNoteConfig,
): string {
	if (!config.navigation) return "";
	const dated = pages
		.map((page) => ({
			page,
			date: parseDailyNoteDate(page.relativePath, config),
		}))
		.filter((entry): entry is { page: ContentPage; date: Date } =>
			Boolean(entry.date),
		)
		.sort((left, right) => left.date.getTime() - right.date.getTime());
	const currentDate = parseDailyNoteDate(currentPage.relativePath, config);
	if (!currentDate) return "";
	const position = dated.findIndex(
		(entry) => entry.page.absolutePath === currentPage.absolutePath,
	);
	if (position < 0) return "";
	const previous = dated[position - 1];
	const next = dated[position + 1];
	const link = (entry: { page: ContentPage; date: Date } | undefined) =>
		entry
			? `<a href="${escapeAttribute(entry.page.routePath)}">${escapeHtml(formatDailyNoteDate(entry.date, config.dateFormat))}</a>`
			: `<span class="daily-notes-placeholder"></span>`;
	return `<nav class="obsidian-daily-navigation" aria-label="Daily notes navigation"><span class="daily-notes-previous">${link(previous)}</span><span class="daily-notes-current">${escapeHtml(formatDailyNoteDate(currentDate, config.dateFormat))}</span><span class="daily-notes-next">${link(next)}</span></nav>`;
}

function tokenRegex(token: string): string {
	if (token === "YYYY") return "(\\d{4})";
	if (token === "YY") return "(\\d{2})";
	if (token === "MMMM") return `(${MONTHS.join("|")})`;
	if (token === "MMM")
		return `(${MONTHS.map((month) => month.slice(0, 3)).join("|")})`;
	if (token === "MM") return "(\\d{2})";
	if (token === "M") return "(\\d{1,2})";
	if (token === "DD") return "(\\d{2})";
	if (token === "D") return "(\\d{1,2})";
	if (token === "dddd") return `(?:${WEEKDAYS.join("|")})`;
	if (token === "ddd")
		return `(?:${WEEKDAYS.map((day) => day.slice(0, 3)).join("|")})`;
	return escapeRegex(token);
}

function adjustDate(
	date: Date,
	sign?: string,
	amount?: string,
	unit?: string,
): Date {
	const adjusted = new Date(date.getTime());
	if (!sign || !amount || !unit) return adjusted;
	const delta = (sign === "-" ? -1 : 1) * Number(amount);
	if (unit.toLowerCase() === "d")
		adjusted.setUTCDate(adjusted.getUTCDate() + delta);
	else if (unit.toLowerCase() === "w")
		adjusted.setUTCDate(adjusted.getUTCDate() + delta * 7);
	else if (unit.toLowerCase() === "m")
		adjusted.setUTCMonth(adjusted.getUTCMonth() + delta);
	else if (unit.toLowerCase() === "y")
		adjusted.setUTCFullYear(adjusted.getUTCFullYear() + delta);
	return adjusted;
}

function escapeRegex(value: string | undefined): string {
	return (value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
	return escapeHtml(value).replace(/"/g, "&quot;");
}
