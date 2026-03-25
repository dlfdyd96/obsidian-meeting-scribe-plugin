import { browser } from "@wdio/globals";

describe("Session List — E2E Tests", function () {
	before(async function () {
		await browser.reloadObsidian({ vault: "./test/e2e/vaults/basic" });
		await browser.pause(2000);

		await browser.executeObsidianCommand(
			"meeting-scribe:open-transcript-sidebar",
		);
		await browser.pause(500);
	});

	describe("Refresh Button", function () {
		it("should have a refresh button with SVG icon", async function () {
			const refreshBtn = await browser.$(
				".meeting-scribe-sidebar-refresh-btn",
			);
			expect(await refreshBtn.isExisting()).toBe(true);

			const hasSvg = await browser.execute(
				(el: Element) => el.querySelector("svg") !== null,
				refreshBtn,
			);
			expect(hasSvg).toBe(true);
		});

		it("should re-render session list when refresh is clicked", async function () {
			// Count sessions before refresh
			const sessionsBefore = await browser.$$(
				".meeting-scribe-sidebar-session-item",
			);
			const countBefore = sessionsBefore.length;

			// Click refresh
			const refreshBtn = await browser.$(
				".meeting-scribe-sidebar-refresh-btn",
			);
			await refreshBtn.click();
			await browser.pause(1000);

			// Should still have sessions after refresh (same or more)
			const sessionsAfter = await browser.$$(
				".meeting-scribe-sidebar-session-item",
			);
			expect(sessionsAfter.length).toBeGreaterThanOrEqual(countBefore);
		});

		it("should not duplicate sessions on multiple refresh clicks", async function () {
			const refreshBtn = await browser.$(
				".meeting-scribe-sidebar-refresh-btn",
			);

			// Click refresh multiple times
			await refreshBtn.click();
			await browser.pause(500);
			await refreshBtn.click();
			await browser.pause(500);

			// Count sessions — should be stable (no duplicates)
			const sessions = await browser.$$(
				".meeting-scribe-sidebar-session-item",
			);
			const firstCount = sessions.length;

			await refreshBtn.click();
			await browser.pause(500);

			const sessionsAfter = await browser.$$(
				".meeting-scribe-sidebar-session-item",
			);
			expect(sessionsAfter.length).toBe(firstCount);
		});
	});

	describe("Session Delete", function () {
		it("should show delete button on session item hover", async function () {
			const sessionItem = await browser.$(
				".meeting-scribe-sidebar-session-item",
			);
			await sessionItem.moveTo();
			await browser.pause(200);

			const deleteBtn = await browser.$(
				".meeting-scribe-sidebar-session-delete-btn",
			);
			// Delete button should exist (may be hidden until hover via CSS)
			const exists = await deleteBtn.isExisting();
			expect(exists).toBe(true);
		});
	});
});
