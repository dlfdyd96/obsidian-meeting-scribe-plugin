import * as path from "path";

export const config: WebdriverIO.Config = {
	runner: "local",
	framework: "mocha",
	specs: ["./test/e2e/specs/**/*.e2e.ts"],
	maxInstances: 1,

	capabilities: [
		{
			browserName: "obsidian",
			browserVersion: "latest",
			"wdio:obsidianOptions": {
				plugins: ["."],
				vault: "test/e2e/vaults/basic",
			},
		},
	],

	services: ["obsidian"],
	reporters: ["obsidian"],
	cacheDir: path.resolve(".obsidian-cache"),
	mochaOpts: {
		ui: "bdd",
		timeout: 60000,
	},
	logLevel: "warn",
};
