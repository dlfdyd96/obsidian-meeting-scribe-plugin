import { browser } from "@wdio/globals";

describe("Epic 13 Bugfix Cycle — E2E Tests", function () {
	before(async function () {
		await browser.reloadObsidian({ vault: "./test/e2e/vaults/basic" });
		await browser.pause(2000);
	});

	describe("Session List Header & Refresh (U3)", function () {
		it("should render session header with title", async function () {
			await browser.executeObsidianCommand(
				"meeting-scribe:open-transcript-sidebar",
			);
			await browser.pause(500);

			const header = await browser.$(
				".meeting-scribe-sidebar-session-header",
			);
			expect(await header.isExisting()).toBe(true);

			const title = await browser.$(
				".meeting-scribe-sidebar-session-header-title",
			);
			expect(await title.isExisting()).toBe(true);
			expect(await title.getText()).toBe("Sessions");
		});

		it("should render refresh button with SVG icon", async function () {
			const refreshBtn = await browser.$(
				".meeting-scribe-sidebar-refresh-btn",
			);
			expect(await refreshBtn.isExisting()).toBe(true);

			const hasSvg = await browser.execute((el: Element) => {
				return el.querySelector("svg") !== null;
			}, refreshBtn);
			expect(hasSvg).toBe(true);
		});

		it("should re-render session list on refresh click", async function () {
			const sessionsBefore = await browser.$$(
				".meeting-scribe-sidebar-session-item",
			);
			const countBefore = sessionsBefore.length;

			const refreshBtn = await browser.$(
				".meeting-scribe-sidebar-refresh-btn",
			);
			await refreshBtn.click();
			await browser.pause(500);

			const sessionsAfter = await browser.$$(
				".meeting-scribe-sidebar-session-item",
			);
			expect(sessionsAfter.length).toBe(countBefore);
		});
	});

	describe("Session Title from Filename (U4)", function () {
		it("should display audio filename as session title instead of time-based title", async function () {
			const title = await browser.$(
				".meeting-scribe-sidebar-session-title",
			);
			expect(await title.isExisting()).toBe(true);

			const text = await title.getText();
			// Should be the audio filename without extension, not "Meeting YYYY-MM-DD HH:MM"
			expect(text).not.toMatch(/^Meeting \d{4}-\d{2}-\d{2}/);
			// The e2e vault has audio file: meeting-2026-01-15.webm
			expect(text).toBe("meeting-2026-01-15");
		});
	});

	describe("Volume Slider Popup (U2)", function () {
		before(async function () {
			// Navigate to transcript view with audio
			const sessionItem = await browser.$(
				".meeting-scribe-sidebar-session-item",
			);
			await sessionItem.click();
			await browser.pause(1000);
		});

		it("should show volume popup on volume button click", async function () {
			const volumeBtn = await browser.$(
				".meeting-scribe-sidebar-player-volume-btn",
			);
			expect(await volumeBtn.isExisting()).toBe(true);
			await volumeBtn.click();
			await browser.pause(200);

			const popup = await browser.$(
				".meeting-scribe-sidebar-player-volume-popup--visible",
			);
			expect(await popup.isExisting()).toBe(true);
		});

		it("should contain a range slider input", async function () {
			const slider = await browser.$(
				".meeting-scribe-sidebar-player-volume-slider",
			);
			expect(await slider.isExisting()).toBe(true);

			const type = await slider.getAttribute("type");
			expect(type).toBe("range");
		});

		it("should close volume popup on second button click", async function () {
			const volumeBtn = await browser.$(
				".meeting-scribe-sidebar-player-volume-btn",
			);
			await volumeBtn.click();
			await browser.pause(200);

			const popup = await browser.$(
				".meeting-scribe-sidebar-player-volume-popup--visible",
			);
			expect(await popup.isExisting()).toBe(false);
		});
	});

	describe("Button Borders Removed (U1)", function () {
		it("should have no visible border on skip and volume buttons", async function () {
			const buttons = await browser.$$(
				".meeting-scribe-sidebar-player-controls button",
			);
			expect(buttons.length).toBeGreaterThanOrEqual(4);

			for (const btn of buttons) {
				const border = await browser.execute((el: Element) => {
					return getComputedStyle(el).borderStyle;
				}, btn);
				expect(border).toBe("none");
			}
		});
	});

	describe("Seek Bar Interaction (Drag Support)", function () {
		it("should have enlarged click area on seek bar via padding", async function () {
			const seekBar = await browser.$(
				".meeting-scribe-sidebar-player-seek-bar",
			);
			expect(await seekBar.isExisting()).toBe(true);

			const padding = await browser.execute((el: Element) => {
				return getComputedStyle(el).paddingTop;
			}, seekBar);
			// Padding should be > 0 for enlarged click area
			expect(parseInt(padding, 10)).toBeGreaterThan(0);
		});

		it("should have seek fill positioned absolutely within seek bar", async function () {
			const seekFill = await browser.$(
				".meeting-scribe-sidebar-player-seek-fill",
			);
			expect(await seekFill.isExisting()).toBe(true);

			const position = await browser.execute((el: Element) => {
				return getComputedStyle(el).position;
			}, seekFill);
			expect(position).toBe("absolute");
		});
	});

	describe("Frontmatter transcript_data Field (S1)", function () {
		it("should have transcript_data field in e2e vault meeting note", async function () {
			const hasField = await browser.execute(() => {
				const app = (window as any).app;
				const file = app.vault.getAbstractFileByPath(
					"Meeting Notes/Meeting 2026-01-15.md",
				);
				if (!file) return false;
				const cache = app.metadataCache.getFileCache(file);
				return !!cache?.frontmatter?.["transcript_data"];
			});
			expect(hasField).toBe(true);
		});
	});

	describe("Auto-Open via transcript_data (not created_by)", function () {
		it("should auto-open sidebar when note has transcript_data field", async function () {
			// Close any existing sidebar
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

			// Open the meeting note (which has transcript_data in frontmatter)
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
			const sidebar = await browser.$(
				'.workspace-leaf-content[data-type="meeting-scribe-transcript"]',
			);
			expect(await sidebar.isExisting()).toBe(true);
		});
	});
});
