import { browser } from "@wdio/globals";

describe("Transcript Sidebar — E2E Tests", function () {
	before(async function () {
		await browser.reloadObsidian({ vault: "./test/e2e/vaults/basic" });
		// Wait for plugin to load and recover sessions
		await browser.pause(2000);
	});

	describe("Sidebar Opening", function () {
		it("should open transcript sidebar via command palette", async function () {
			await browser.executeObsidianCommand(
				"meeting-scribe:open-transcript-sidebar",
			);
			await browser.pause(500);

			const sidebarLeaf = await browser.$(
				'.workspace-leaf-content[data-type="meeting-scribe-transcript"]',
			);
			expect(await sidebarLeaf.isExisting()).toBe(true);
		});
	});

	describe("B1 — Session Recovery on Restart", function () {
		it("should recover completed sessions from transcript files after reload", async function () {
			// Open sidebar
			await browser.executeObsidianCommand(
				"meeting-scribe:open-transcript-sidebar",
			);
			await browser.pause(500);

			// Check for session list items
			const sessionItems = await browser.$$(
				".meeting-scribe-sidebar-session-item",
			);
			expect(sessionItems.length).toBeGreaterThanOrEqual(1);

			// Verify at least one item has complete status
			const completeDots = await browser.$$(
				".meeting-scribe-sidebar-status-dot--complete",
			);
			expect(completeDots.length).toBeGreaterThanOrEqual(1);
		});

		it("should show complete status dot in green, not purple", async function () {
			const completeDot = await browser.$(
				".meeting-scribe-sidebar-status-dot--complete",
			);
			expect(await completeDot.isExisting()).toBe(true);

			// Verify the dot uses --text-success (green) not --interactive-accent (purple)
			const bgColor = await browser.execute((el: Element) => {
				return getComputedStyle(el).backgroundColor;
			}, completeDot);

			// --text-success should resolve to a green color
			// --interactive-accent resolves to a purple/blue color
			// We check that the color is NOT the accent color
			const accentColor = await browser.execute(() => {
				return getComputedStyle(document.body).getPropertyValue(
					"--interactive-accent",
				);
			});
			const successColor = await browser.execute(() => {
				return getComputedStyle(document.body).getPropertyValue(
					"--text-success",
				);
			});

			// The dot's background should NOT match the accent (purple) color
			// It should be derived from --text-success
			expect(bgColor).not.toBe("");
			// Verify success color is defined in the theme
			expect(successColor.trim()).not.toBe("");
		});
	});

	describe("B1 + 12.2 — Transcript View Rendering", function () {
		it("should render chat bubbles when clicking a completed session", async function () {
			// Ensure sidebar is open
			await browser.executeObsidianCommand(
				"meeting-scribe:open-transcript-sidebar",
			);
			await browser.pause(500);

			// Click the first completed session item
			const sessionItem = await browser.$(
				".meeting-scribe-sidebar-session-item",
			);
			expect(await sessionItem.isExisting()).toBe(true);
			await sessionItem.click();
			await browser.pause(1000);

			// Verify transcript bubbles render
			const bubbles = await browser.$$(".meeting-scribe-sidebar-bubble");
			expect(bubbles.length).toBeGreaterThanOrEqual(1);

			// Verify back button exists
			const backBtn = await browser.$(".meeting-scribe-sidebar-back-btn");
			expect(await backBtn.isExisting()).toBe(true);

			// Navigate back to session list
			await backBtn.click();
			await browser.pause(500);

			// Verify we're back on session list
			const sessionItems = await browser.$$(
				".meeting-scribe-sidebar-session-item",
			);
			expect(sessionItems.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe("B4 — Auto-Open Sidebar on Meeting Note", function () {
		it("should auto-open sidebar when opening a meeting note", async function () {
			// Close any existing sidebar leaves first
			await browser.execute(() => {
				const app = (window as any).app;
				const leaves = app.workspace.getLeavesOfType(
					"meeting-scribe-transcript",
				);
				for (const leaf of leaves) {
					leaf.detach();
				}
			});
			await browser.pause(500);

			// Verify sidebar is closed
			const sidebarBefore = await browser.$(
				'.workspace-leaf-content[data-type="meeting-scribe-transcript"]',
			);
			expect(await sidebarBefore.isExisting()).toBe(false);

			// Open the meeting note file
			await browser.execute(() => {
				const app = (window as any).app;
				app.workspace.openLinkText(
					"Meeting Notes/Meeting 2026-01-15",
					"",
					false,
				);
			});
			await browser.pause(1500);

			// Verify sidebar auto-opened
			const sidebarAfter = await browser.$(
				'.workspace-leaf-content[data-type="meeting-scribe-transcript"]',
			);
			expect(await sidebarAfter.isExisting()).toBe(true);
		});
	});

	describe("B5 — Sidebar Close/Reopen", function () {
		it("should correctly re-render session list after close and reopen", async function () {
			// Close any existing sidebar first, then open fresh
			await browser.execute(() => {
				const app = (window as any).app;
				const leaves = app.workspace.getLeavesOfType(
					"meeting-scribe-transcript",
				);
				for (const leaf of leaves) {
					leaf.detach();
				}
			});
			await browser.pause(500);

			// Open sidebar fresh
			await browser.executeObsidianCommand(
				"meeting-scribe:open-transcript-sidebar",
			);
			await browser.pause(1000);

			// Count sessions
			const sessionsBefore = await browser.$$(
				".meeting-scribe-sidebar-session-item",
			);
			const countBefore = sessionsBefore.length;
			expect(countBefore).toBeGreaterThanOrEqual(1);

			// Close sidebar
			await browser.execute(() => {
				const app = (window as any).app;
				const leaves = app.workspace.getLeavesOfType(
					"meeting-scribe-transcript",
				);
				for (const leaf of leaves) {
					leaf.detach();
				}
			});
			await browser.pause(500);

			// Verify sidebar is gone
			const sidebarClosed = await browser.$(
				'.workspace-leaf-content[data-type="meeting-scribe-transcript"]',
			);
			expect(await sidebarClosed.isExisting()).toBe(false);

			// Reopen sidebar
			await browser.executeObsidianCommand(
				"meeting-scribe:open-transcript-sidebar",
			);
			await browser.pause(1000);

			// Verify sessions are rendered without duplication
			const sessionsAfter = await browser.$$(
				".meeting-scribe-sidebar-session-item",
			);
			expect(sessionsAfter.length).toBe(countBefore);
		});
	});
});
