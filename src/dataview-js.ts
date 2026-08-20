import type { DailyNoteConfig } from "./daily-notes.ts";
import { parseDailyNoteDate } from "./daily-notes.ts";
import type { ContentIndex, ContentPage } from "./types.ts";
import { encodeRoutePath, normalizeFilePathKey } from "./utils.ts";

interface JsLink {
	kind: "link";
	label: string;
	href: string;
}

interface JsPage {
	[key: string]: unknown;
	file: Record<string, unknown>;
}

interface JsEnvironment {
	values: Map<string, unknown>;
}

export interface DataviewJsResult {
	html?: string;
	error?: string;
}

const FORBIDDEN_SOURCE =
	/\b(?:globalThis|global|process|require|import|export|fetch|Bun|Deno|window|document|eval|Function|constructor|prototype|__proto__|setTimeout|setInterval|fs|node:)\b/i;

export function renderDataviewJs(
	source: string,
	currentPage: ContentPage,
	index: ContentIndex,
	dailyConfig?: DailyNoteConfig,
): DataviewJsResult {
	if (FORBIDDEN_SOURCE.test(source)) {
		return {
			error: "DataviewJS source references a forbidden host or runtime API.",
		};
	}

	try {
		const environment: JsEnvironment = { values: new Map() };
		const output: string[] = [];
		for (const statement of splitStatements(source)) {
			if (!statement.trim()) continue;
			const declaration =
				/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/.exec(
					statement.trim(),
				);
			if (declaration?.[1] && declaration[2]) {
				environment.values.set(
					declaration[1],
					evaluateExpression(
						declaration[2],
						environment,
						currentPage,
						index,
						dailyConfig,
					),
				);
				continue;
			}
			const call =
				/^dv\.(table|list|taskList|paragraph|header)\s*\(([\s\S]*)\)$/.exec(
					statement.trim(),
				);
			if (!call?.[1]) {
				throw new Error(
					`Unsupported DataviewJS statement: ${statement.trim()}`,
				);
			}
			const args = splitTopLevel(call[2] ?? "").map((argument) =>
				evaluateExpression(
					argument,
					environment,
					currentPage,
					index,
					dailyConfig,
				),
			);
			output.push(renderApiCall(call[1], args));
		}
		return { html: output.join("\n") };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

function evaluateExpression(
	source: string,
	environment: JsEnvironment,
	currentPage: ContentPage,
	index: ContentIndex,
	dailyConfig?: DailyNoteConfig,
): unknown {
	const value = source.trim();
	if (!value) return null;
	const arrow = splitTopLevelOperator(value, "=>");
	if (arrow) {
		const parameter = arrow.left.replace(/[()]/g, "").trim();
		return { kind: "function", parameter, body: arrow.right };
	}
	for (const operator of [
		"||",
		"&&",
		"===",
		"!==",
		"==",
		"!=",
		">=",
		"<=",
		">",
		"<",
	]) {
		const split = splitTopLevelOperator(value, operator);
		if (split) {
			const left = evaluateExpression(
				split.left,
				environment,
				currentPage,
				index,
				dailyConfig,
			);
			const right = evaluateExpression(
				split.right,
				environment,
				currentPage,
				index,
				dailyConfig,
			);
			return applyOperator(operator, left, right);
		}
	}
	if (value.startsWith("!")) {
		return !evaluateExpression(
			value.slice(1),
			environment,
			currentPage,
			index,
			dailyConfig,
		);
	}
	if (isQuoted(value)) return value.slice(1, -1).replace(/\\([\\"'])/g, "$1");
	if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
	if (value === "true") return true;
	if (value === "false") return false;
	if (value === "null" || value === "undefined") return null;
	if (value.startsWith("[") && value.endsWith("]")) {
		return splitTopLevel(value.slice(1, -1)).map((item) =>
			evaluateExpression(item, environment, currentPage, index, dailyConfig),
		);
	}
	if (value.startsWith("{") && value.endsWith("}")) {
		const object: Record<string, unknown> = {};
		for (const field of splitTopLevel(value.slice(1, -1))) {
			const separator = splitTopLevelOperator(field, ":");
			if (!separator) throw new Error(`Invalid object field: ${field}.`);
			object[stripQuotes(separator.left.trim())] = evaluateExpression(
				separator.right,
				environment,
				currentPage,
				index,
				dailyConfig,
			);
		}
		return object;
	}
	const call = splitCall(value);
	if (call && (!call.name.includes(".") || call.name.startsWith("dv."))) {
		const args = splitTopLevel(call.arguments).map((argument) =>
			evaluateExpression(
				argument,
				environment,
				currentPage,
				index,
				dailyConfig,
			),
		);
		return evaluateCall(call.name, args, currentPage, index, dailyConfig);
	}
	const chain = splitMemberChain(value);
	if (chain.length > 1) {
		const first = chain.shift() ?? "";
		let result: unknown;
		const firstCall = chain[0] ? splitCall(chain[0]) : undefined;
		if (first === "dv" && firstCall) {
			chain.shift();
			const args = splitTopLevel(firstCall.arguments).map((argument) =>
				evaluateExpression(
					argument,
					environment,
					currentPage,
					index,
					dailyConfig,
				),
			);
			result = evaluateCall(
				`dv.${firstCall.name}`,
				args,
				currentPage,
				index,
				dailyConfig,
			);
		} else {
			result = evaluateExpression(
				first,
				environment,
				currentPage,
				index,
				dailyConfig,
			);
		}
		for (const part of chain) {
			const methodCall = splitCall(part);
			if (methodCall) {
				const args = splitTopLevel(methodCall.arguments).map((argument) =>
					evaluateExpression(
						argument,
						environment,
						currentPage,
						index,
						dailyConfig,
					),
				);
				result = applyCollectionMethod(
					result,
					methodCall.name,
					args,
					environment,
					currentPage,
					index,
					dailyConfig,
				);
			} else {
				result = readProperty(result, part);
			}
		}
		return result;
	}
	if (environment.values.has(value)) return environment.values.get(value);
	return readProperty(pageValue(currentPage, index, dailyConfig), value);
}

function evaluateCall(
	name: string,
	args: unknown[],
	currentPage: ContentPage,
	index: ContentIndex,
	dailyConfig?: DailyNoteConfig,
): unknown {
	if (name === "dv.pages") return pagesForSource(args[0], index, dailyConfig);
	if (name === "dv.current") return pageValue(currentPage, index, dailyConfig);
	if (name === "dv.page") {
		const target = normalizeFilePathKey(String(args[0] ?? "")).toLowerCase();
		const page =
			index.byFilePathKeyCI.get(target)?.[0] ??
			index.byBaseNameCI.get(target)?.[0];
		return page ? pageValue(page, index, dailyConfig) : null;
	}
	if (name === "dv.array") return Array.isArray(args[0]) ? args[0] : [args[0]];
	if (name === "dv.date" || name === "date") {
		const date = new Date(String(args[0] ?? ""));
		return Number.isNaN(date.getTime()) ? null : date;
	}
	throw new Error(`Unsupported DataviewJS function: ${name}.`);
}

function applyCollectionMethod(
	value: unknown,
	method: string,
	args: unknown[],
	environment: JsEnvironment,
	currentPage: ContentPage,
	index: ContentIndex,
	dailyConfig?: DailyNoteConfig,
): unknown {
	let collection: unknown[];
	if (Array.isArray(value)) {
		collection = value;
	} else if (
		value &&
		typeof value === "object" &&
		"kind" in value &&
		value.kind === "collection-method" &&
		"collection" in value &&
		Array.isArray(value.collection)
	) {
		collection = value.collection;
	} else {
		throw new Error(`.${method}() is only supported on Dataview collections.`);
	}
	const callback = args[0];
	const applyCallback = (item: unknown): unknown => {
		if (
			!callback ||
			typeof callback !== "object" ||
			!("kind" in callback) ||
			callback.kind !== "function" ||
			!("parameter" in callback) ||
			!("body" in callback)
		) {
			throw new Error(`.${method}() requires a restricted arrow callback.`);
		}
		const child: JsEnvironment = {
			values: new Map(environment.values),
		};
		const parameter = callback.parameter;
		const body = callback.body;
		if (typeof parameter !== "string" || typeof body !== "string") {
			throw new Error(`.${method}() received an invalid arrow callback.`);
		}
		child.values.set(parameter, item);
		return evaluateExpression(body, child, currentPage, index, dailyConfig);
	};
	if (method === "where" || method === "filter")
		return collection.filter((item) => Boolean(applyCallback(item)));
	if (method === "map") return collection.map((item) => applyCallback(item));
	if (method === "sort") {
		const direction =
			String(args[1] ?? "asc").toLowerCase() === "desc" ? -1 : 1;
		return [...collection].sort(
			(left, right) =>
				direction *
				String(applyCallback(left)).localeCompare(
					String(applyCallback(right)),
					undefined,
					{
						numeric: true,
						sensitivity: "base",
					},
				),
		);
	}
	if (method === "limit") return collection.slice(0, Number(args[0] ?? 0));
	if (method === "slice")
		return collection.slice(
			Number(args[0] ?? 0),
			Number(args[1] ?? collection.length),
		);
	if (method === "join") return collection.join(String(args[0] ?? ", "));
	if (method === "flat") return collection.flat(Number(args[0] ?? 1));
	throw new Error(`Unsupported DataviewJS collection method: ${method}.`);
}

function readProperty(value: unknown, property: string): unknown {
	if (Array.isArray(value)) {
		if (property === "length") return value.length;
		if (
			[
				"where",
				"filter",
				"map",
				"sort",
				"limit",
				"slice",
				"join",
				"flat",
			].includes(property)
		) {
			return { kind: "collection-method", collection: value, method: property };
		}
		return value.map((item) => readProperty(item, property));
	}
	if (!value || typeof value !== "object") return undefined;
	const entry = Object.entries(value).find(
		([key]) => key === property || key.toLowerCase() === property.toLowerCase(),
	);
	return entry?.[1];
}

function renderApiCall(name: string, args: unknown[]): string {
	if (name === "paragraph")
		return `<p class="dataviewjs-paragraph">${renderValue(args[0])}</p>`;
	if (name === "header") {
		const level = Math.min(6, Math.max(1, Number(args[0] ?? 2)));
		return `<h${level}>${renderValue(args[1])}</h${level}>`;
	}
	if (name === "list") {
		const values = flattenValues(args[0]);
		return `<ul class="dataviewjs-list">${values.map((value) => `<li>${renderValue(value)}</li>`).join("")}</ul>`;
	}
	if (name === "taskList") {
		const values = flattenValues(args[0]);
		return `<ul class="dataviewjs-task-list">${values.map((value) => renderTask(value)).join("")}</ul>`;
	}
	const headers = Array.isArray(args[0]) ? args[0] : [];
	const rows = Array.isArray(args[1]) ? args[1] : [];
	return `<table class="dataviewjs-table"><thead><tr>${headers.map((header) => `<th>${escapeHtml(String(header ?? ""))}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${(Array.isArray(row) ? row : [row]).map((value) => `<td>${renderValue(value)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function renderTask(value: unknown): string {
	if (!value || typeof value !== "object")
		return `<li>${renderValue(value)}</li>`;
	const completed = "completed" in value && value.completed === true;
	const text = "text" in value ? String(value.text ?? "") : String(value);
	return `<li><input type="checkbox" disabled${completed ? " checked" : ""} /> ${escapeHtml(text)}</li>`;
}

function renderValue(value: unknown): string {
	if (value == null) return "";
	if (isLink(value))
		return `<a href="${escapeAttribute(value.href)}">${escapeHtml(value.label)}</a>`;
	if (value instanceof Date)
		return escapeHtml(value.toISOString().slice(0, 10));
	if (Array.isArray(value)) return value.map(renderValue).join(", ");
	if (typeof value === "object") return escapeHtml(JSON.stringify(value));
	return escapeHtml(String(value));
}

function pageValue(
	page: ContentPage,
	index: ContentIndex,
	dailyConfig?: DailyNoteConfig,
): JsPage {
	const dailyDate = dailyConfig
		? parseDailyNoteDate(page.relativePath, dailyConfig)
		: undefined;
	const file: Record<string, unknown> = {
		path: page.relativePath,
		name: page.baseName,
		folder: page.relativePath.includes("/")
			? page.relativePath.slice(0, page.relativePath.lastIndexOf("/"))
			: "",
		ext: page.relativePath.split(".").pop() ?? "md",
		link: pageLink(page),
		tags: page.tags.map((tag) => `#${tag}`),
		day: dailyDate,
		tasks: page.dataviewTasks,
		lists: page.dataviewLists,
		outlinks: page.wikilinkTargets.map((target) =>
			linkForTarget(target, index),
		),
	};
	return {
		...page.dataviewFields,
		file,
		tags: file.tags,
		name: page.title ?? page.baseName,
	};
}

function pagesForSource(
	source: unknown,
	index: ContentIndex,
	dailyConfig?: DailyNoteConfig,
): JsPage[] {
	const pages = index.pages.map((page) => pageValue(page, index, dailyConfig));
	if (source == null) return pages;
	const query = String(source);
	if (query.startsWith("#"))
		return pages.filter(
			(page) => Array.isArray(page.file.tags) && page.file.tags.includes(query),
		);
	if (query.startsWith('"') || query.startsWith("'")) {
		const folder = stripQuotes(query).replace(/\/$/, "");
		return pages.filter(
			(page) =>
				page.file.path === folder ||
				String(page.file.path).startsWith(`${folder}/`),
		);
	}
	return pages;
}

function applyOperator(
	operator: string,
	left: unknown,
	right: unknown,
): unknown {
	if (operator === "||") return Boolean(left) || Boolean(right);
	if (operator === "&&") return Boolean(left) && Boolean(right);
	if (operator === "===" || operator === "==")
		return comparable(left) === comparable(right);
	if (operator === "!==" || operator === "!=")
		return comparable(left) !== comparable(right);
	if (operator === ">") return Number(left) > Number(right);
	if (operator === "<") return Number(left) < Number(right);
	if (operator === ">=") return Number(left) >= Number(right);
	return Number(left) <= Number(right);
}

function comparable(value: unknown): unknown {
	return isLink(value)
		? value.href
		: value instanceof Date
			? value.getTime()
			: value;
}

function flattenValues(value: unknown): unknown[] {
	return Array.isArray(value)
		? value.flat(Infinity)
		: value == null
			? []
			: [value];
}

function splitCall(
	value: string,
): { name: string; arguments: string } | undefined {
	const open = value.indexOf("(");
	if (open <= 0 || !value.endsWith(")")) return undefined;
	let depth = 0;
	let quote = "";
	for (let index = open; index < value.length; index += 1) {
		const char = value[index];
		if (quote) {
			if (char === quote && value[index - 1] !== "\\") quote = "";
			continue;
		}
		if (char === '"' || char === "'") quote = char;
		else if (char === "(") depth += 1;
		else if (char === ")") depth -= 1;
		if (depth === 0 && index !== value.length - 1) return undefined;
	}
	return depth === 0
		? {
				name: value.slice(0, open).trim(),
				arguments: value.slice(open + 1, -1),
			}
		: undefined;
}

function splitMemberChain(value: string): string[] {
	const result: string[] = [];
	let start = 0;
	let depth = 0;
	let quote = "";
	for (let index = 0; index < value.length; index += 1) {
		const char = value[index];
		if (quote) {
			if (char === quote && value[index - 1] !== "\\") quote = "";
			continue;
		}
		if (char === '"' || char === "'") quote = char;
		else if (char === "(") depth += 1;
		else if (char === ")") depth -= 1;
		else if (char === "." && depth === 0) {
			result.push(value.slice(start, index).trim());
			start = index + 1;
		}
	}
	result.push(value.slice(start).trim());
	return result.filter(Boolean);
}

function splitTopLevelOperator(
	value: string,
	operator: string,
): { left: string; right: string } | undefined {
	let depth = 0;
	let quote = "";
	for (let index = 0; index <= value.length - operator.length; index += 1) {
		const char = value[index];
		if (quote) {
			if (char === quote && value[index - 1] !== "\\") quote = "";
			continue;
		}
		if (char === '"' || char === "'") quote = char;
		else if (char === "(" || char === "[" || char === "{") depth += 1;
		else if (char === ")" || char === "]" || char === "}") depth -= 1;
		else if (
			depth === 0 &&
			value.slice(index, index + operator.length) === operator
		)
			return {
				left: value.slice(0, index),
				right: value.slice(index + operator.length),
			};
	}
	return undefined;
}

function splitTopLevel(value: string): string[] {
	const result: string[] = [];
	let start = 0;
	let depth = 0;
	let quote = "";
	for (let index = 0; index < value.length; index += 1) {
		const char = value[index] ?? "";
		if (quote) {
			if (char === quote && value[index - 1] !== "\\") quote = "";
			continue;
		}
		if (char === '"' || char === "'") quote = char;
		else if (["(", "[", "{"].includes(char)) depth += 1;
		else if ([")", "]", "}"].includes(char)) depth -= 1;
		else if ((char === "," || char === ";") && depth === 0) {
			result.push(value.slice(start, index).trim());
			start = index + 1;
		}
	}
	result.push(value.slice(start).trim());
	return result.filter(Boolean);
}

function splitStatements(source: string): string[] {
	return splitTopLevel(source.replace(/\/\/[^\n]*/g, ""));
}

function isQuoted(value: string): boolean {
	return (
		value.length >= 2 &&
		((value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'")))
	);
}

function stripQuotes(value: string): string {
	return isQuoted(value) ? value.slice(1, -1) : value;
}

function pageLink(page: ContentPage): JsLink {
	return {
		kind: "link",
		label: page.title ?? page.baseName,
		href: encodeRoutePath(page.routePath),
	};
}

function linkForTarget(target: string, index: ContentIndex): JsLink {
	const key = normalizeFilePathKey(target).toLowerCase();
	const page =
		index.byFilePathKeyCI.get(key)?.[0] ??
		index.byBaseNameCI.get(key.split("/").pop() ?? key)?.[0];
	return page
		? pageLink(page)
		: { kind: "link", label: target, href: `/${target}` };
}

function isLink(value: unknown): value is JsLink {
	return Boolean(
		value &&
			typeof value === "object" &&
			"kind" in value &&
			value.kind === "link",
	);
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
