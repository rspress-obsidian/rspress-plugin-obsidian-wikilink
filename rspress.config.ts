import * as path from "node:path";
import { defineConfig } from "@rspress/core";
import { pluginObsidianWikiLink } from "./src";

const docsRoot = process.env.OBSIDIAN_RSPRESS_ROOT
	? path.resolve(process.env.OBSIDIAN_RSPRESS_ROOT)
	: path.join(__dirname, "docs");

export default defineConfig({
	root: docsRoot,
	title: "Rspress Obsidian WikiLink",
	description: "Obsidian-style wikilinks for Rspress documentation",
	globalStyles: path.join(__dirname, "docs/theme.css"),
	plugins: [
		pluginObsidianWikiLink({
			enableTagLinking: true,
			enableCallouts: true,
			enableBacklinks: true,
			enableTransclusion: true,
			enableMediaEmbeds: true,
			enableTagPages: true,
			enableDefaultStyles: true,
		}),
	],
});
