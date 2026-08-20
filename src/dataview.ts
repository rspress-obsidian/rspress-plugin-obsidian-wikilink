import type { DailyNoteConfig } from "./daily-notes.ts";
import { parseDailyNoteDate } from "./daily-notes.ts";
import type {
	ContentIndex,
	ContentPage,
	DataviewListItem,
	DataviewTask,
} from "./types.ts";
import { encodeRoutePath, normalizeFilePathKey } from "./utils.ts";

interface DataviewLink {
	kind: "link";
	label: string;
	href: string;
}

interface QueryRow {
	page: ContentPage;
	values: Record<string, unknown>;
	item?: DataviewTask | DataviewListItem;
	groupRows?: QueryRow[];
}

interface QueryField {
	expression: string;
	label: string;
}

interface QueryPlan {
	kind: "TABLE" | "LIST" | "TASK" | "CALENDAR";
	fields: QueryField[];
	withoutId: boolean;
	source?: string;
	where: string[];
	sort: Array<{ expression: string; descending: boolean }>;
	groupBy?: { expression: string; label: string };
	flatten: Array<{ expression: string; alias?: string }>;
	limit?: number;
}

interface QueryResult {
	html?: string;
	error?: string;
}

const INLINE_FIELD_PATTERN = /[[(]([^\]():]+?)::\s*([^\])\n]+?)[\])]/g;
const STANDALONE_FIELD_PATTERN =
	/^\s*(?:[-*+]\s+|\d+[.)]\s+)?([^:\n]+?)::\s*(.*?)\s*$/;
const TASK_PATTERN = /^(\s*)([-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/;
const LIST_PATTERN = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

export function extractDataviewMetadata(
	markdown: string,
	frontmatter: Record<string, unknown>,
	filePath: string,
): {
	fields: Record<string, unknown>;
	tasks: DataviewTask[];
	lists: DataviewListItem[];
} {
	const fields: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(frontmatter)) {
		fields[key] = normalizeValue(value);
		fields[sanitizeFieldKey(key)] = normalizeValue(value);
	}

	const tasks: DataviewTask[] = [];
	const lists: DataviewListItem[] = [];
	const lines = markdown.split(/\r?\n/);
	let inFrontmatter = lines[0]?.trim() === "---";
	let inFence = false;

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (inFrontmatter) {
			if (index > 0 && line.trim() === "---") inFrontmatter = false;
			continue;
		}
		if (/^\s*(```|~~~)/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const taskMatch = TASK_PATTERN.exec(line);
		if (taskMatch) {
			const text = taskMatch[4] ?? "";
			const itemFields = fieldsFromLine(text);
			const task = {
				text: stripInlineFieldMarkup(text),
				completed: (taskMatch[3] ?? "").toLowerCase() === "x",
				line: index + 1,
				path: filePath,
				fields: itemFields,
			};
			tasks.push(task);
			lists.push(task);
			continue;
		}

		const listMatch = LIST_PATTERN.exec(line);
		if (listMatch) {
			const text = listMatch[3] ?? "";
			lists.push({
				text: stripInlineFieldMarkup(text),
				line: index + 1,
				path: filePath,
				fields: fieldsFromLine(text),
			});
			continue;
		}

		for (const field of extractInlineFields(line)) {
			fields[field.key] = field.value;
			fields[sanitizeFieldKey(field.key)] = field.value;
		}
	}

	return { fields, tasks, lists };
}

export function renderDataviewQuery(
	query: string,
	currentPage: ContentPage,
	index: ContentIndex,
	dailyConfig?: DailyNoteConfig,
): QueryResult {
	try {
		const plan = parseQuery(query);
		const rows = executeQuery(plan, currentPage, index, dailyConfig);
		return { html: renderRows(plan, rows) };
	} catch (error) {
		return {
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export function renderDataviewInline(
	expression: string,
	currentPage: ContentPage,
	index: ContentIndex,
	dailyConfig?: DailyNoteConfig,
): QueryResult {
	try {
		const row = createPageRow(currentPage, index, dailyConfig);
		const value = evaluateExpression(expression.trim(), row, index);
		return {
			html: `<span class="dataview-inline">${renderValue(value)}</span>`,
		};
	} catch (error) {
		return {
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function parseQuery(source: string): QueryPlan {
	const lines = source
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"));
	const header = lines.shift();
	if (!header) throw new Error("Dataview query is empty.");

	const headerMatch = /^(TABLE|LIST|TASK|CALENDAR)\b\s*(.*)$/i.exec(header);
	if (!headerMatch) {
		throw new Error(`Unsupported Dataview query type: ${header}.`);
	}
	const kind = headerMatch[1]?.toUpperCase() as QueryPlan["kind"];
	const headerBody = headerMatch[2]?.trim() ?? "";
	const withoutId = /^WITHOUT\s+ID\b/i.test(headerBody);
	const fieldBody = withoutId
		? headerBody.replace(/^WITHOUT\s+ID\b/i, "").trim()
		: headerBody;
	const fields =
		kind === "TABLE" || kind === "CALENDAR"
			? parseFields(fieldBody)
			: kind === "LIST" && fieldBody
				? parseFields(fieldBody)
				: [];
	const plan: QueryPlan = {
		kind,
		fields,
		withoutId,
		where: [],
		sort: [],
		flatten: [],
	};

	for (const line of lines) {
		const from = /^FROM\s+(.+)$/i.exec(line);
		if (from) {
			if (plan.source)
				throw new Error("A Dataview query can contain only one FROM clause.");
			plan.source = from[1]?.trim();
			continue;
		}
		const where = /^WHERE\s+(.+)$/i.exec(line);
		if (where) {
			plan.where.push(where[1]?.trim() ?? "");
			continue;
		}
		const sort = /^SORT\s+(.+)$/i.exec(line);
		if (sort) {
			for (const item of splitTopLevel(sort[1] ?? ",")) {
				const match = /^(.*?)(?:\s+(ASC|DESC))?$/i.exec(item.trim());
				if (!match?.[1]) throw new Error(`Invalid SORT expression: ${item}.`);
				plan.sort.push({
					expression: match[1].trim(),
					descending: match[2]?.toUpperCase() === "DESC",
				});
			}
			continue;
		}
		const group = /^GROUP\s+BY\s+(.+)$/i.exec(line);
		if (group) {
			plan.groupBy = parseAliasedField(group[1] ?? "");
			continue;
		}
		const flatten = /^FLATTEN\s+(.+)$/i.exec(line);
		if (flatten) {
			const field = parseAliasedField(flatten[1] ?? "");
			plan.flatten.push({
				expression: field.expression,
				alias: field.label === field.expression ? undefined : field.label,
			});
			continue;
		}
		const limit = /^LIMIT\s+(\d+)$/i.exec(line);
		if (limit) {
			plan.limit = Number(limit[1]);
			continue;
		}
		throw new Error(`Unsupported Dataview command: ${line}.`);
	}

	return plan;
}

function parseFields(source: string): QueryField[] {
	if (!source) return [];
	return splitTopLevel(source).map(parseAliasedField);
}

function parseAliasedField(source: string): QueryField {
	const match = /^(.*?)\s+AS\s+(.+)$/i.exec(source.trim());
	if (match?.[1] && match[2]) {
		return { expression: match[1].trim(), label: stripQuotes(match[2].trim()) };
	}
	return { expression: source.trim(), label: source.trim() };
}
function executeQuery(
	plan: QueryPlan,
	currentPage: ContentPage,
	index: ContentIndex,
	dailyConfig?: DailyNoteConfig,
): QueryRow[] {
	let rows =
		plan.kind === "TASK"
			? createTaskRows(index, dailyConfig)
			: createPageRows(index, dailyConfig);
	if (plan.source)
		rows = rows.filter((row) => matchesSource(plan.source ?? "", row));
	for (const flatten of plan.flatten) {
		const next: QueryRow[] = [];
		const defaultAlias =
			flatten.expression.split(".").at(-1) ?? flatten.expression;
		const alias = flatten.alias ?? defaultAlias;
		for (const row of rows) {
			const value = evaluateExpression(flatten.expression, row, index);
			if (Array.isArray(value)) {
				for (const item of value) {
					next.push({
						...row,
						values: { ...row.values, [alias]: item },
					});
				}
			} else {
				next.push({ ...row, values: { ...row.values, [alias]: value } });
			}
		}
		rows = next;
	}
	for (const expression of plan.where) {
		rows = rows.filter((row) =>
			Boolean(evaluateExpression(expression, row, index)),
		);
	}
	if (plan.groupBy) {
		const grouped = new Map<string, QueryRow[]>();
		for (const row of rows) {
			const value = evaluateExpression(plan.groupBy.expression, row, index);
			const key = stableValue(value);
			const group = grouped.get(key) ?? [];
			group.push(row);
			grouped.set(key, group);
		}
		rows = [...grouped.values()].map((group) => {
			const first = group[0];
			const keyValue = first
				? evaluateExpression(plan.groupBy?.expression ?? "", first, index)
				: null;
			return {
				page: first?.page ?? currentPage,
				values: {
					...(first?.values ?? {}),
					[plan.groupBy?.label ?? "key"]: keyValue,
					key: keyValue,
					rows: group,
				},
				groupRows: group,
			};
		});
	}
	for (let sortIndex = plan.sort.length - 1; sortIndex >= 0; sortIndex -= 1) {
		const sort = plan.sort[sortIndex];
		if (!sort) continue;
		rows.sort((left, right) => {
			const comparison = compareValues(
				evaluateExpression(sort.expression, left, index),
				evaluateExpression(sort.expression, right, index),
			);
			return sort.descending ? -comparison : comparison;
		});
	}
	return typeof plan.limit === "number" ? rows.slice(0, plan.limit) : rows;
}

function createPageRows(
	index: ContentIndex,
	dailyConfig?: DailyNoteConfig,
): QueryRow[] {
	return index.pages.map((page) => createPageRow(page, index, dailyConfig));
}

function createTaskRows(
	index: ContentIndex,
	dailyConfig?: DailyNoteConfig,
): QueryRow[] {
	const rows: QueryRow[] = [];
	for (const page of index.pages) {
		for (const task of page.dataviewTasks) {
			rows.push({
				page,
				item: task,
				values: {
					...createPageValues(page, index, dailyConfig),
					...task.fields,
					text: task.text,
					completed: task.completed,
					line: task.line,
				},
			});
		}
	}
	return rows;
}

function createPageRow(
	page: ContentPage,
	index: ContentIndex,
	dailyConfig?: DailyNoteConfig,
): QueryRow {
	return { page, values: createPageValues(page, index, dailyConfig) };
}

function createPageValues(
	page: ContentPage,
	index: ContentIndex,
	dailyConfig?: DailyNoteConfig,
): Record<string, unknown> {
	const ctime = new Date(page.fileCtimeMs);
	const mtime = new Date(page.fileMtimeMs);
	const dailyDate = dailyConfig
		? parseDailyNoteDate(page.relativePath, dailyConfig)
		: undefined;
	const file = {
		path: page.relativePath,
		name: page.baseName,
		folder: page.relativePath.includes("/")
			? page.relativePath.slice(0, page.relativePath.lastIndexOf("/"))
			: "",
		ext: page.relativePath.split(".").pop() ?? "md",
		size: page.fileSizeBytes,
		link: pageLink(page),
		tags: page.tags.map((tag) => `#${tag}`),
		etags: [...page.tags],
		outlinks: page.wikilinkTargets.map((target) =>
			linkForTarget(target, index),
		),
		inlinks: (index.backlinks.get(page.routePath) ?? []).map((backlink) => ({
			kind: "link" as const,
			label: backlink.title,
			href: backlink.routePath,
		})),
		tasks: page.dataviewTasks,
		lists: page.dataviewLists,
		ctime,
		mtime,
		cday: ctime.toISOString().slice(0, 10),
		mday: mtime.toISOString().slice(0, 10),
		day: dailyDate,
	};
	return {
		...page.dataviewFields,
		file,
		tags: file.tags,
		aliases: page.aliases,
		name: page.title ?? page.baseName,
	};
}

function matchesSource(source: string, row: QueryRow): boolean {
	const tokens =
		source.match(
			/\(|\)|\bAND\b|\bOR\b|-?#[^\s()]+|-?\[\[[^\]]+\]\]|-?"[^"]+"/gi,
		) ?? [];
	if (tokens.length === 0) return false;
	let cursor = 0;
	const parseOr = (): boolean => {
		let value = parseAnd();
		while (tokens[cursor]?.toUpperCase() === "OR") {
			cursor += 1;
			const right = parseAnd();
			value = value || right;
		}
		return value;
	};
	const parseAnd = (): boolean => {
		let value = parseAtom();
		while (tokens[cursor]?.toUpperCase() === "AND") {
			cursor += 1;
			const right = parseAtom();
			value = value && right;
		}
		return value;
	};
	const parseAtom = (): boolean => {
		const token = tokens[cursor++];
		if (!token) return false;
		if (token === "(") {
			const value = parseOr();
			if (tokens[cursor] === ")") cursor += 1;
			return value;
		}
		if (token.startsWith("-"))
			return !matchesSourceAtom(token.slice(1), row.page);
		return matchesSourceAtom(token, row.page);
	};
	return parseOr();
}

function matchesSourceAtom(source: string, page: ContentPage): boolean {
	if (source.startsWith("#"))
		return page.tags.some(
			(tag) => tag === source.slice(1) || tag.startsWith(`${source.slice(1)}/`),
		);
	if (source.startsWith("[[") && source.endsWith("]]"))
		return page.wikilinkTargets.includes(
			normalizeFilePathKey(source.slice(2, -2)).toLowerCase(),
		);
	const folder = stripQuotes(source).replace(/\/$/, "");
	return (
		page.filePathKey === folder || page.filePathKey.startsWith(`${folder}/`)
	);
}

function renderRows(plan: QueryPlan, rows: QueryRow[]): string {
	if (plan.kind === "LIST") {
		return `<ul class="dataview dataview-list">${rows.map((row) => `<li>${renderValue(plan.fields[0] ? evaluateExpression(plan.fields[0].expression, row, undefined) : row.values.file && typeof row.values.file === "object" ? (row.values.file as { link?: unknown }).link : row.page.baseName)}</li>`).join("")}</ul>`;
	}
	if (plan.kind === "TASK") {
		const taskHtml = rows
			.map((row) => {
				if (row.groupRows) {
					return `<li><strong>${renderValue(getField(row, "key"))}</strong><ul>${row.groupRows.map(renderTaskItem).join("")}</ul></li>`;
				}
				return renderTaskItem(row);
			})
			.join("");
		return `<ul class="dataview dataview-task-list">${taskHtml}</ul>`;
	}
	if (plan.kind === "CALENDAR") {
		return `<div class="dataview dataview-calendar"><ul>${rows.map((row) => `<li>${renderValue(plan.fields[0] ? evaluateExpression(plan.fields[0].expression, row, undefined) : null)} — ${renderValue(pageLink(row.page))}</li>`).join("")}</ul></div>`;
	}
	const fields =
		plan.fields.length > 0
			? plan.fields
			: [{ expression: "file.link", label: "File" }];
	const headers = plan.withoutId
		? fields
		: [{ expression: "file.link", label: "File" }, ...fields];
	const head = headers
		.map((field) => `<th>${escapeHtml(field.label)}</th>`)
		.join("");
	const body = rows
		.map(
			(row) =>
				`<tr>${headers.map((field) => `<td>${renderValue(evaluateExpression(field.expression, row, undefined))}</td>`).join("")}</tr>`,
		)
		.join("");
	return `<table class="dataview dataview-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}
function renderTaskItem(row: QueryRow): string {
	const task = row.item;
	if (!task) return "";
	const checked = "completed" in task && task.completed ? " checked" : "";
	return `<li><input type="checkbox" disabled${checked} /> ${escapeHtml(task.text)}</li>`;
}

function evaluateExpression(
	source: string,
	row: QueryRow,
	_index?: ContentIndex,
): unknown {
	const tokens = tokenizeExpression(source);
	let cursor = 0;
	const parseOr = (): unknown => {
		let value = parseAnd();
		while (tokens[cursor]?.toUpperCase() === "OR") {
			cursor += 1;
			const right = Boolean(parseAnd());
			value = Boolean(value) || right;
		}
		return value;
	};
	const parseAnd = (): unknown => {
		let value = parseComparison();
		while (tokens[cursor]?.toUpperCase() === "AND") {
			cursor += 1;
			const right = Boolean(parseComparison());
			value = Boolean(value) && right;
		}
		return value;
	};
	const parseComparison = (): unknown => {
		let left = parseAdditive();
		const operator = tokens[cursor];
		if (operator && ["=", "!=", "<", "<=", ">", ">="].includes(operator)) {
			cursor += 1;
			const right = parseAdditive();
			const comparison = compareValues(left, right);
			left =
				operator === "="
					? comparison === 0
					: operator === "!="
						? comparison !== 0
						: operator === "<"
							? comparison < 0
							: operator === "<="
								? comparison <= 0
								: operator === ">"
									? comparison > 0
									: comparison >= 0;
		}
		return left;
	};
	const parseAdditive = (): unknown => {
		let value = parseMultiplicative();
		while (tokens[cursor] === "+" || tokens[cursor] === "-") {
			const operator = tokens[cursor++];
			const right = parseMultiplicative();
			value =
				operator === "+"
					? typeof value === "string" || typeof right === "string"
						? `${value ?? ""}${right ?? ""}`
						: Number(value ?? 0) + Number(right ?? 0)
					: Number(value ?? 0) - Number(right ?? 0);
		}
		return value;
	};
	const parseMultiplicative = (): unknown => {
		let value = parseUnary();
		while (tokens[cursor] === "*" || tokens[cursor] === "/") {
			const operator = tokens[cursor++];
			const right = Number(parseUnary());
			value =
				operator === "*"
					? Number(value ?? 0) * right
					: right === 0
						? null
						: Number(value ?? 0) / right;
		}
		return value;
	};
	const parseUnary = (): unknown => {
		if (tokens[cursor] === "!" || tokens[cursor]?.toUpperCase() === "NOT") {
			cursor += 1;
			return !parseUnary();
		}
		if (tokens[cursor] === "-") {
			cursor += 1;
			return -Number(parseUnary());
		}
		return parsePrimary();
	};
	const parsePrimary = (): unknown => {
		const token = tokens[cursor++];
		if (token === "(") {
			const value = parseOr();
			if (tokens[cursor] === ")") cursor += 1;
			return value;
		}
		if (!token) return null;
		if (token.startsWith('"') || token.startsWith("'"))
			return token.slice(1, -1).replace(/\\([\\"'])/g, "$1");
		if (/^\d+(?:\.\d+)?$/.test(token)) return Number(token);
		if (token.toLowerCase() === "today")
			return new Date().toISOString().slice(0, 10);
		if (token.toLowerCase() === "true") return true;
		if (token.toLowerCase() === "false") return false;
		if (token.toLowerCase() === "null") return null;
		if (tokens[cursor] === "(") {
			cursor += 1;
			const args: unknown[] = [];
			while (tokens[cursor] && tokens[cursor] !== ")") {
				args.push(parseOr());
				if (tokens[cursor] === ",") cursor += 1;
				else break;
			}
			if (tokens[cursor] === ")") cursor += 1;
			return evaluateFunction(token, args);
		}
		return getField(row, token);
	};
	return parseOr();
}

function tokenizeExpression(source: string): string[] {
	const tokens: string[] = [];
	const pattern =
		/\s*(\[\[[^\]]+\]\]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|<=|>=|!=|=|<|>|\(|\)|,|!|\+|\*|\/|-|\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_.-]*)/g;
	for (const match of source.matchAll(pattern)) {
		if (match[1]) tokens.push(match[1]);
	}
	return tokens;
}

function evaluateFunction(name: string, args: unknown[]): unknown {
	const normalized = name.toLowerCase();
	if (normalized === "date") return parseDateValue(args[0]);
	if (normalized === "today") return new Date().toISOString().slice(0, 10);
	if (normalized === "length")
		return Array.isArray(args[0]) || typeof args[0] === "string"
			? args[0].length
			: 0;
	if (normalized === "contains")
		return Array.isArray(args[0])
			? args[0].some((value) => compareValues(value, args[1]) === 0)
			: String(args[0] ?? "").includes(String(args[1] ?? ""));
	if (normalized === "startswith")
		return String(args[0] ?? "").startsWith(String(args[1] ?? ""));
	if (normalized === "endswith")
		return String(args[0] ?? "").endsWith(String(args[1] ?? ""));
	if (normalized === "lower") return String(args[0] ?? "").toLowerCase();
	if (normalized === "upper") return String(args[0] ?? "").toUpperCase();
	if (normalized === "round") {
		const digits = Number(args[1] ?? 0);
		const factor = 10 ** digits;
		return Math.round(Number(args[0] ?? 0) * factor) / factor;
	}
	if (normalized === "floor") return Math.floor(Number(args[0] ?? 0));
	if (normalized === "ceil") return Math.ceil(Number(args[0] ?? 0));
	if (normalized === "regexmatch") {
		return new RegExp(String(args[0] ?? "")).test(String(args[1] ?? ""));
	}
	if (normalized === "replace")
		return String(args[0] ?? "").replace(
			new RegExp(String(args[1] ?? ""), "g"),
			String(args[2] ?? ""),
		);
	if (normalized === "split")
		return String(args[0] ?? "").split(String(args[1] ?? ","));
	if (normalized === "join")
		return Array.isArray(args[0])
			? args[0].map(String).join(String(args[1] ?? ", "))
			: String(args[0] ?? "");
	if (normalized === "typeof") {
		if (args[0] instanceof Date) return "date";
		return Array.isArray(args[0])
			? "array"
			: args[0] === null
				? "null"
				: typeof args[0];
	}
	if (normalized === "default") return args[0] == null ? args[1] : args[0];
	if (normalized === "choice") return args[0] ? args[1] : args[2];
	if (["sum", "average", "min", "max"].includes(normalized)) {
		const values = (Array.isArray(args[0]) ? args[0] : args)
			.map(Number)
			.filter(Number.isFinite);
		if (normalized === "sum")
			return values.reduce((sum, value) => sum + value, 0);
		if (normalized === "average")
			return values.length
				? values.reduce((sum, value) => sum + value, 0) / values.length
				: null;
		if (normalized === "min") return values.length ? Math.min(...values) : null;
		return values.length ? Math.max(...values) : null;
	}
	throw new Error(`Unsupported Dataview function: ${name}.`);
}
function getField(row: QueryRow, path: string): unknown {
	if (path.startsWith("[[") && path.endsWith("]]"))
		return {
			kind: "link",
			label: path.slice(2, -2),
			href: "#",
		} satisfies DataviewLink;
	const parts = path.split(".");
	let current: unknown = row.values;
	for (const part of parts) {
		if (Array.isArray(current)) {
			current = current.map((item) => readProperty(item, part));
			continue;
		}
		current = readProperty(current, part);
		if (current === undefined) return undefined;
	}
	return current;
}

function readProperty(value: unknown, property: string): unknown {
	if (!value || typeof value !== "object") return undefined;
	if ("values" in value && value.values && typeof value.values === "object") {
		value = value.values;
	}
	if (!value || typeof value !== "object") return undefined;
	const entry = Object.entries(value).find(
		([key]) =>
			key === property ||
			key.toLowerCase() === property.toLowerCase() ||
			sanitizeFieldKey(key) === property.toLowerCase(),
	);
	return entry?.[1];
}

function renderValue(value: unknown): string {
	if (value == null) return "";
	if (isDataviewLink(value))
		return `<a href="${escapeAttribute(value.href)}">${escapeHtml(value.label)}</a>`;
	if (value instanceof Date)
		return escapeHtml(value.toISOString().slice(0, 10));
	if (Array.isArray(value)) return value.map(renderValue).join(", ");
	if (typeof value === "object") return escapeHtml(JSON.stringify(value));
	return escapeHtml(String(value));
}

function createLink(page: ContentPage): DataviewLink {
	return {
		kind: "link",
		label: page.title ?? page.baseName,
		href: encodeRoutePath(page.routePath),
	};
}

function pageLink(page: ContentPage): DataviewLink {
	return createLink(page);
}

function linkForTarget(target: string, index: ContentIndex): DataviewLink {
	const key = normalizeFilePathKey(target).toLowerCase();
	const page =
		index.byFilePathKeyCI.get(key)?.[0] ??
		index.byBaseNameCI.get(key.split("/").pop() ?? key)?.[0];
	return page
		? createLink(page)
		: { kind: "link", label: target, href: `/${target}` };
}

function extractInlineFields(
	line: string,
): Array<{ key: string; value: unknown }> {
	const fields: Array<{ key: string; value: unknown }> = [];
	for (const match of line.matchAll(INLINE_FIELD_PATTERN)) {
		const key = stripMarkdownMarkup(match[1] ?? "").trim();
		if (key) fields.push({ key, value: parseValue(match[2] ?? "") });
	}
	const standalone = STANDALONE_FIELD_PATTERN.exec(line);
	if (standalone?.[1])
		fields.push({
			key: stripMarkdownMarkup(standalone[1]).trim(),
			value: parseValue(standalone[2] ?? ""),
		});
	return fields;
}

function fieldsFromLine(line: string): Record<string, unknown> {
	const fields: Record<string, unknown> = {};
	for (const field of extractInlineFields(line)) {
		fields[field.key] = field.value;
		fields[sanitizeFieldKey(field.key)] = field.value;
	}
	return fields;
}

function parseValue(value: string): unknown {
	const trimmed = value.trim();
	if (!trimmed) return "";
	if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === "true";
	if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
	if (/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(trimmed))
		return parseDateValue(trimmed);
	if (
		(trimmed.startsWith("[") && trimmed.endsWith("]")) ||
		(trimmed.startsWith("(") && trimmed.endsWith(")"))
	)
		return trimmed
			.slice(1, -1)
			.split(",")
			.map((item) => parseValue(item));
	return stripQuotes(trimmed);
}

function parseDateValue(value: unknown): Date | null {
	if (value instanceof Date) return value;
	if (typeof value !== "string") return null;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeValue(value: unknown): unknown {
	if (value instanceof Date) return value;
	if (Array.isArray(value)) return value.map(normalizeValue);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, normalizeValue(item)]),
		);
	return value;
}

function sanitizeFieldKey(key: string): string {
	return stripMarkdownMarkup(key).trim().toLowerCase().replace(/\s+/g, "-");
}

function stripInlineFieldMarkup(value: string): string {
	return value.replace(INLINE_FIELD_PATTERN, "").trim();
}

function stripMarkdownMarkup(value: string): string {
	return value.replace(/[*_~`]/g, "");
}

function stripQuotes(value: string): string {
	return value.replace(/^("|')|("|')$/g, "");
}

function splitTopLevel(value: string): string[] {
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
		else if (char === "," && depth === 0) {
			result.push(value.slice(start, index).trim());
			start = index + 1;
		}
	}
	result.push(value.slice(start).trim());
	return result.filter(Boolean);
}

function compareValues(left: unknown, right: unknown): number {
	if (left == null && right == null) return 0;
	if (left == null) return -1;
	if (right == null) return 1;
	if (isDataviewLink(left) && isDataviewLink(right)) {
		return left.href === right.href
			? 0
			: left.label.localeCompare(right.label, undefined, {
					sensitivity: "base",
				});
	}
	if (isDataviewLink(left)) return left.label.localeCompare(String(right));
	if (isDataviewLink(right)) return String(left).localeCompare(right.label);
	const leftDate = left instanceof Date ? left.getTime() : undefined;
	const rightDate = right instanceof Date ? right.getTime() : undefined;
	if (leftDate !== undefined && rightDate !== undefined)
		return leftDate - rightDate;
	if (typeof left === "number" && typeof right === "number")
		return left - right;
	return String(left).localeCompare(String(right), undefined, {
		numeric: true,
		sensitivity: "base",
	});
}

function stableValue(value: unknown): string {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

function isDataviewLink(value: unknown): value is DataviewLink {
	return Boolean(
		value &&
			typeof value === "object" &&
			(value as DataviewLink).kind === "link",
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
