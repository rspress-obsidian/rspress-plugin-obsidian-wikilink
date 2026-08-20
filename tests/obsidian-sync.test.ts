import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncObsidianVault } from "../scripts/obsidian-sync.ts";

const temporaryRoots: string[] = [];

async function createFixture(): Promise<{
	sourceDir: string;
	targetDir: string;
}> {
	const root = await fs.promises.mkdtemp(
		path.join(os.tmpdir(), "obsidian-rspress-sync-test-"),
	);
	temporaryRoots.push(root);
	return {
		sourceDir: path.join(root, "vault"),
		targetDir: path.join(root, "generated"),
	};
}

afterEach(async () => {
	await Promise.all(
		temporaryRoots
			.splice(0)
			.map((root) => fs.promises.rm(root, { recursive: true, force: true })),
	);
});

describe("syncObsidianVault", () => {
	test("copies visible vault files and skips private directories", async () => {
		const fixture = await createFixture();
		await fs.promises.mkdir(path.join(fixture.sourceDir, ".obsidian"), {
			recursive: true,
		});
		await fs.promises.mkdir(path.join(fixture.sourceDir, "assets"), {
			recursive: true,
		});
		await fs.promises.writeFile(
			path.join(fixture.sourceDir, "Welcome.md"),
			"# Welcome\n",
		);
		await fs.promises.writeFile(
			path.join(fixture.sourceDir, "assets", "image.png"),
			"asset",
		);
		await fs.promises.writeFile(
			path.join(fixture.sourceDir, ".obsidian", "workspace.json"),
			"private",
		);

		const result = await syncObsidianVault(fixture);

		expect(result).toMatchObject({ copied: 2, unchanged: 0, removed: 0 });
		expect(
			await Bun.file(path.join(fixture.targetDir, "Welcome.md")).text(),
		).toBe("# Welcome\n");
		expect(
			await Bun.file(
				path.join(fixture.targetDir, "assets", "image.png"),
			).text(),
		).toBe("asset");
		expect(
			await Bun.file(
				path.join(fixture.targetDir, ".obsidian", "workspace.json"),
			).exists(),
		).toBe(false);
	});

	test("refuses a non-empty target without its manifest", async () => {
		const fixture = await createFixture();
		await fs.promises.mkdir(fixture.sourceDir, { recursive: true });
		await fs.promises.mkdir(fixture.targetDir, { recursive: true });
		await fs.promises.writeFile(
			path.join(fixture.targetDir, "manual.md"),
			"keep",
		);

		await expect(syncObsidianVault(fixture)).rejects.toThrow(
			"non-empty target",
		);
	});

	test("reuses unchanged files and removes deleted source files", async () => {
		const fixture = await createFixture();
		await fs.promises.mkdir(fixture.sourceDir, { recursive: true });
		const sourceFile = path.join(fixture.sourceDir, "Draft.md");
		await fs.promises.writeFile(sourceFile, "draft");

		const first = await syncObsidianVault(fixture);
		const second = await syncObsidianVault(fixture);
		await fs.promises.rm(sourceFile);
		const third = await syncObsidianVault(fixture);

		expect(first).toMatchObject({ copied: 1, unchanged: 0, removed: 0 });
		expect(second).toMatchObject({ copied: 0, unchanged: 1, removed: 0 });
		expect(third).toMatchObject({ copied: 0, unchanged: 0, removed: 1 });
		expect(
			await Bun.file(path.join(fixture.targetDir, "Draft.md")).exists(),
		).toBe(false);
	});
});
