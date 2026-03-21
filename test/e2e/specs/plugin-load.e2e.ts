import { browser } from "@wdio/globals";

describe("Meeting Scribe Plugin — Smoke Tests", function () {
	before(async function () {
		await browser.reloadObsidian({ vault: "./test/e2e/vaults/basic" });
	});

	it("should load plugin and show in installed plugins", async function () {
		// Open settings
		await browser.executeObsidianCommand("app:open-settings");
		await browser.pause(500);

		// Navigate to Community plugins tab
		const settingsTabs = await browser.$$(".vertical-tab-nav-item");
		let communityTab: WebdriverIO.Element | undefined;
		for (const tab of settingsTabs) {
			const text = await tab.getText();
			if (text.toLowerCase().includes("community plugin")) {
				communityTab = tab;
				break;
			}
		}

		if (communityTab) {
			await communityTab.click();
			await browser.pause(300);

			// Verify Meeting Scribe appears in the installed plugins
			const pageText = await browser.$(".vertical-tab-content-container").getText();
			expect(pageText.toLowerCase()).toContain("meeting scribe");
		} else {
			// Fallback: check that the plugin is loaded by verifying status bar
			const statusBarItems = await browser.$$(".status-bar-item");
			let found = false;
			for (const item of statusBarItems) {
				const text = await item.getText();
				if (text.includes("Meeting Scribe")) {
					found = true;
					break;
				}
			}
			expect(found).toBe(true);
		}

		await browser.keys("Escape");
	});

	it("should render status bar element with Meeting Scribe text", async function () {
		const statusBarItems = await browser.$$(".status-bar-item");
		let found = false;
		for (const item of statusBarItems) {
			const text = await item.getText();
			if (text.includes("Meeting Scribe")) {
				found = true;
				break;
			}
		}
		expect(found).toBe(true);
	});

	it("should open settings tab with all required sections", async function () {
		// Open settings
		await browser.executeObsidianCommand("app:open-settings");
		await browser.pause(500);

		// Navigate to Meeting Scribe settings tab
		const settingsTabs = await browser.$$(".vertical-tab-nav-item");
		let pluginTab: WebdriverIO.Element | undefined;
		for (const tab of settingsTabs) {
			const text = await tab.getText();
			if (text.includes("Meeting Scribe")) {
				pluginTab = tab;
				break;
			}
		}
		expect(pluginTab).toBeDefined();
		await pluginTab!.click();
		await browser.pause(300);

		// Verify required sections exist (case-insensitive)
		const containerText = await browser
			.$(".vertical-tab-content-container")
			.getText();
		const lowerText = containerText.toLowerCase();

		expect(lowerText).toContain("api configuration");
		expect(lowerText).toContain("output");
		expect(lowerText).toContain("recording");

		await browser.keys("Escape");
	});
});
