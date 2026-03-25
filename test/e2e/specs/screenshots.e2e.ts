import { browser } from "@wdio/globals";
import * as path from "path";

const SCREENSHOT_DIR = path.resolve("docs/images");

async function shot(name: string): Promise<void> {
	await browser.saveScreenshot(path.join(SCREENSHOT_DIR, `${name}.png`));
}

describe("README Screenshots", function () {
	before(async function () {
		await browser.reloadObsidian({ vault: "./test/e2e/vaults/basic" });
		await browser.pause(2000);
	});

	it("01 — Session list", async function () {
		await browser.executeObsidianCommand(
			"meeting-scribe:open-transcript-sidebar",
		);
		await browser.pause(1000);
		await shot("01-session-list");
	});

	it("02 — Transcript view with chat bubbles", async function () {
		const sessionItem = await browser.$(
			".meeting-scribe-sidebar-session-item",
		);
		await sessionItem.click();
		await browser.pause(1000);
		await shot("02-transcript-view");
	});

	it("03 — Audio player controls", async function () {
		// Focus on the player area
		const player = await browser.$(
			".meeting-scribe-sidebar-player",
		);
		expect(await player.isExisting()).toBe(true);
		await shot("03-audio-player");
	});

	it("04 — Inline editing mode", async function () {
		const textEl = await browser.$(
			".meeting-scribe-sidebar-bubble-text",
		);
		await textEl.click();
		await browser.pause(300);
		await shot("04-inline-editing");

		// Exit edit mode
		await browser.keys("Escape");
		await browser.pause(200);
	});

	it("05 — Hover action buttons (delete + split)", async function () {
		// Show action buttons via JS (hover unreliable in headless)
		await browser.execute(() => {
			const actions = document.querySelector(
				".meeting-scribe-sidebar-bubble-actions",
			) as HTMLElement;
			if (actions) actions.style.display = "flex";
		});
		await browser.pause(200);
		await shot("05-hover-actions");

		// Hide again
		await browser.execute(() => {
			const actions = document.querySelector(
				".meeting-scribe-sidebar-bubble-actions",
			) as HTMLElement;
			if (actions) actions.style.display = "";
		});
	});

	it("06 — Speaker name mapping popover", async function () {
		const speakerEl = await browser.$(
			".meeting-scribe-sidebar-bubble-speaker",
		);
		await speakerEl.click();
		await browser.pause(500);
		await shot("06-speaker-mapping");

		// Close popover
		const cancelBtn = await browser.$(
			".meeting-scribe-sidebar-speaker-popover-cancel-btn",
		);
		if (await cancelBtn.isExisting()) {
			await cancelBtn.click();
			await browser.pause(200);
		}
	});

	it("07 — Re-summarize confirmation modal", async function () {
		const btns = await browser.$$(
			".meeting-scribe-sidebar-action-btn",
		);
		if (btns.length > 0) {
			await btns[0]!.click();
			await browser.pause(500);
			await shot("07-resummarize-modal");

			// Cancel
			const cancelBtn = await browser.$(
				".modal .meeting-scribe-modal-actions button:not(.mod-cta)",
			);
			if (await cancelBtn.isExisting()) {
				await cancelBtn.click();
				await browser.pause(200);
			}
		}
	});

	it("08 — Volume slider popup", async function () {
		const volumeBtn = await browser.$(
			".meeting-scribe-sidebar-player-volume-btn",
		);
		await volumeBtn.click();
		await browser.pause(300);
		await shot("08-volume-slider");

		await volumeBtn.click();
		await browser.pause(200);
	});

	it("09 — Settings tab", async function () {
		await browser.executeObsidianCommand("app:open-settings");
		await browser.pause(1500);

		// Click Meeting Scribe tab in settings sidebar
		const pluginTab = await browser.execute(() => {
			const tabs = document.querySelectorAll(".vertical-tab-nav-item");
			for (const tab of tabs) {
				if (tab.textContent?.includes("Meeting Scribe")) {
					(tab as HTMLElement).click();
					return true;
				}
			}
			return false;
		});
		await browser.pause(1000);
		await shot("09-settings");

		// Close settings
		await browser.keys("Escape");
		await browser.pause(300);
	});
});
