#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";

const MANIFEST_NAME = ".obsidian-rspress-sync.json";
const MANIFEST_VERSION = 1 as const;
const DEFAULT_DEBOUNCE_MS = 250;
const TEMP_DIRECTORY_PREFIX = ".obsidian-rspress-sync-tmp-";
const IGNORED_DIRECTORY_NAMES = new Set([
	".cache",
	".git",
	".obsidian",
	".rspress",
	"dist",
	"doc_build",
	"node_modules",
]);

interface ManifestFile {
	size: number;
	mtimeMs: number;
}

interface SyncManifest {
	version: typeof MANIFEST_VERSION;
	files: Record<string, ManifestFile>;
}

interface SourceFile {
	absolutePath: string;
	relativePath: string;
	size: number;
	mtimeMs: number;
}

export interface ObsidianSyncOptions {
	sourceDir: string;
	targetDir: string;
	debounceMs?: number;
}

export interface ObsidianSyncResult {
	copied: number;
	unchanged: number;
	removed: number;
	skipped: number;
}

function normalizeRelativePath(relativePath: string): string {
	return relativePath.split(path.sep).join("/");
}

function isInside(candidate: string, parent: string): boolean {
	return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}

function isIgnoredDirectory(name: string): boolean {
	return name.startsWith(".") || IGNORED_DIRECTORY_NAMES.has(name);
}

async function collectSourceFiles(
	rootDir: string,
	currentRelativePath = "",
): Promise<SourceFile[]> {
	const currentDir = path.join(rootDir, currentRelativePath);
	const entries = await fs.promises.readdir(currentDir, {
		withFileTypes: true,
	});
	const files: SourceFile[] = [];

	for (const entry of entries.sort((left, right) =>
		left.name.localeCompare(right.name),
	)) {
		if (entry.isDirectory() && isIgnoredDirectory(entry.name)) {
			continue;
		}
		if (entry.isDirectory()) {
			files.push(
				...(await collectSourceFiles(
					rootDir,
					path.join(currentRelativePath, entry.name),
				)),
			);
			continue;
		}
		if (!entry.isFile() || entry.name.startsWith(".")) {
			continue;
		}

		const relativePath = normalizeRelativePath(
			path.join(currentRelativePath, entry.name),
		);
		const absolutePath = path.join(rootDir, relativePath);
		const stats = await fs.promises.stat(absolutePath);
		files.push({
			absolutePath,
			relativePath,
			size: stats.size,
			mtimeMs: stats.mtimeMs,
		});
	}

	return files;
}

async function readManifest(
	targetDir: string,
): Promise<SyncManifest | undefined> {
	const manifestPath = path.join(targetDir, MANIFEST_NAME);
	try {
		const raw = await fs.promises.readFile(manifestPath, "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			(parsed as { version?: unknown }).version !== MANIFEST_VERSION ||
			typeof (parsed as { files?: unknown }).files !== "object" ||
			(parsed as { files?: unknown }).files === null
		) {
			throw new Error(`Invalid ${MANIFEST_NAME} in ${targetDir}.`);
		}
		return parsed as SyncManifest;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
}

async function prepareTarget(
	targetDir: string,
): Promise<SyncManifest | undefined> {
	await fs.promises.mkdir(targetDir, { recursive: true });
	const manifest = await readManifest(targetDir);
	if (manifest) return manifest;

	const entries = await fs.promises.readdir(targetDir);
	if (entries.length > 0) {
		throw new Error(
			`Refusing to sync into non-empty target "${targetDir}" without ${MANIFEST_NAME}. Use a dedicated generated directory.`,
		);
	}
	return undefined;
}

async function copyAtomically(
	sourceFile: SourceFile,
	targetDir: string,
	tempDir: string,
): Promise<void> {
	const tempPath = path.join(tempDir, sourceFile.relativePath);
	const targetPath = path.join(targetDir, sourceFile.relativePath);
	await fs.promises.mkdir(path.dirname(tempPath), { recursive: true });
	await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
	await fs.promises.copyFile(sourceFile.absolutePath, tempPath);
	await fs.promises.rename(tempPath, targetPath);
}

async function writeManifest(
	targetDir: string,
	manifest: SyncManifest,
): Promise<void> {
	const manifestPath = path.join(targetDir, MANIFEST_NAME);
	const temporaryPath = `${manifestPath}.tmp`;
	await fs.promises.writeFile(
		temporaryPath,
		`${JSON.stringify(manifest, null, 2)}\n`,
		"utf8",
	);
	await fs.promises.rename(temporaryPath, manifestPath);
}

/**
 * Copy visible vault files into a dedicated, guarded Rspress source directory.
 * The target is never touched unless it contains this tool's manifest marker.
 */
export async function syncObsidianVault(
	options: ObsidianSyncOptions,
): Promise<ObsidianSyncResult> {
	const sourceDir = path.resolve(options.sourceDir);
	const targetDir = path.resolve(options.targetDir);
	if (
		sourceDir === targetDir ||
		isInside(targetDir, sourceDir) ||
		isInside(sourceDir, targetDir)
	) {
		throw new Error("Source and target directories must be separate trees.");
	}

	const sourceStats = await fs.promises.stat(sourceDir);
	if (!sourceStats.isDirectory()) {
		throw new Error(`Obsidian source is not a directory: ${sourceDir}`);
	}

	const previousManifest = await prepareTarget(targetDir);
	const sourceFiles = await collectSourceFiles(sourceDir);
	const nextFiles: Record<string, ManifestFile> = {};
	const previousFiles = previousManifest?.files ?? {};
	const temporaryDirectory = await fs.promises.mkdtemp(
		path.join(targetDir, TEMP_DIRECTORY_PREFIX),
	);
	let copied = 0;
	let unchanged = 0;
	let removed = 0;

	try {
		for (const sourceFile of sourceFiles) {
			const metadata = {
				size: sourceFile.size,
				mtimeMs: sourceFile.mtimeMs,
			};
			nextFiles[sourceFile.relativePath] = metadata;
			const previous = previousFiles[sourceFile.relativePath];
			if (
				previous?.size === metadata.size &&
				previous.mtimeMs === metadata.mtimeMs
			) {
				unchanged += 1;
				continue;
			}
			await copyAtomically(sourceFile, targetDir, temporaryDirectory);
			copied += 1;
		}

		for (const relativePath of Object.keys(previousFiles)) {
			if (relativePath in nextFiles) continue;
			const targetPath = path.join(targetDir, relativePath);
			await fs.promises.rm(targetPath, { force: true });
			removed += 1;
		}

		await writeManifest(targetDir, {
			version: MANIFEST_VERSION,
			files: nextFiles,
		});
	} finally {
		await fs.promises.rm(temporaryDirectory, {
			recursive: true,
			force: true,
		});
	}

	return {
		copied,
		unchanged,
		removed,
		skipped: 0,
	};
}

/** Watch a vault and serialize debounced one-way syncs until interrupted. */
export async function watchObsidianVault(
	options: ObsidianSyncOptions,
): Promise<void> {
	const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
	await syncObsidianVault(options);
	const sourceDir = path.resolve(options.sourceDir);
	const watcher = fs.watch(sourceDir, { recursive: true });
	let timer: ReturnType<typeof setTimeout> | undefined;
	let syncing = false;
	let pending = false;

	const runSync = async (): Promise<void> => {
		if (syncing) {
			pending = true;
			return;
		}
		syncing = true;
		try {
			const result = await syncObsidianVault(options);
			if (result.copied > 0 || result.removed > 0) {
				console.log(
					`[obsidian-sync] copied ${result.copied}, removed ${result.removed}, unchanged ${result.unchanged}`,
				);
			}
		} catch (error) {
			console.error(
				`[obsidian-sync] sync failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			syncing = false;
			if (pending) {
				pending = false;
				scheduleSync(0);
			}
		}
	};

	const scheduleSync = (delay: number): void => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			timer = undefined;
			void runSync();
		}, delay);
	};

	await new Promise<void>((resolve, reject) => {
		const close = (): void => {
			clearTimeout(timer);
			timer = undefined;
			watcher.close();
			process.removeListener("SIGINT", close);
			process.removeListener("SIGTERM", close);
			resolve();
		};
		const onError = (error: Error): void => {
			watcher.close();
			reject(error);
		};
		watcher.on("change", () => scheduleSync(debounceMs));
		watcher.on("rename", () => scheduleSync(debounceMs));
		watcher.on("error", onError);
		process.once("SIGINT", close);
		process.once("SIGTERM", close);
	});
}

function usage(): string {
	return [
		"Usage:",
		"  bun scripts/obsidian-sync.ts --source <vault> --target <generated-docs>",
		"  bun scripts/obsidian-sync.ts --source <vault> --target <generated-docs> --watch",
		"",
		"Options:",
		"  --source, -s    Obsidian vault directory",
		"  --target, -t    Dedicated generated Rspress source directory",
		"  --watch, -w     Keep watching and sync after debounced file changes",
		"  --debounce      Watch debounce in milliseconds (default: 250)",
	].join("\n");
}

function parseArgs(argv: string[]): ObsidianSyncOptions & { watch: boolean } {
	let sourceDir = "";
	let targetDir = "";
	let debounceMs = DEFAULT_DEBOUNCE_MS;
	let watch = false;

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		switch (argument) {
			case "--source":
			case "-s":
				sourceDir = argv[++index] ?? "";
				break;
			case "--target":
			case "-t":
				targetDir = argv[++index] ?? "";
				break;
			case "--watch":
			case "-w":
				watch = true;
				break;
			case "--debounce": {
				const value = Number(argv[++index]);
				if (!Number.isFinite(value) || value < 0) {
					throw new Error("--debounce must be a non-negative number.");
				}
				debounceMs = value;
				break;
			}
			case "--help":
			case "-h":
				console.log(usage());
				process.exit(0);
				break;
			default:
				throw new Error(`Unknown argument: ${argument}\n\n${usage()}`);
		}
	}

	if (!sourceDir || !targetDir) {
		throw new Error(`--source and --target are required.\n\n${usage()}`);
	}
	return { sourceDir, targetDir, debounceMs, watch };
}

if (import.meta.main) {
	try {
		const options = parseArgs(process.argv.slice(2));
		if (options.watch) {
			console.log(
				`[obsidian-sync] watching ${path.resolve(options.sourceDir)} → ${path.resolve(options.targetDir)}`,
			);
			await watchObsidianVault(options);
		} else {
			const result = await syncObsidianVault(options);
			console.log(
				`[obsidian-sync] copied ${result.copied}, removed ${result.removed}, unchanged ${result.unchanged}`,
			);
		}
	} catch (error) {
		console.error(
			`[obsidian-sync] ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exitCode = 1;
	}
}
