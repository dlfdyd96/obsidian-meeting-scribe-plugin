import { browser } from "@wdio/globals";

describe("Audio Player Hotkeys — E2E Tests", function () {
	before(async function () {
		await browser.reloadObsidian({ vault: "./test/e2e/vaults/basic" });
		await browser.pause(2000);

		// Open sidebar and navigate to transcript view with audio
		await browser.executeObsidianCommand(
			"meeting-scribe:open-transcript-sidebar",
		);
		await browser.pause(500);

		const sessionItem = await browser.$(
			".meeting-scribe-sidebar-session-item",
		);
		await sessionItem.click();
		await browser.pause(1000);
	});

	describe("Command Registration (AC #1)", function () {
		it("should register audio-play-pause command", async function () {
			const exists = await browser.execute(() => {
				const app = (window as any).app;
				return app.commands.commands["meeting-scribe:audio-play-pause"] !== undefined;
			});
			expect(exists).toBe(true);
		});

		it("should register audio-skip-back command", async function () {
			const exists = await browser.execute(() => {
				const app = (window as any).app;
				return app.commands.commands["meeting-scribe:audio-skip-back"] !== undefined;
			});
			expect(exists).toBe(true);
		});

		it("should register audio-skip-forward command", async function () {
			const exists = await browser.execute(() => {
				const app = (window as any).app;
				return app.commands.commands["meeting-scribe:audio-skip-forward"] !== undefined;
			});
			expect(exists).toBe(true);
		});

		it("should have correct command names for hotkey settings display", async function () {
			const names = await browser.execute(() => {
				const app = (window as any).app;
				const cmds = app.commands.commands;
				return {
					playPause: cmds["meeting-scribe:audio-play-pause"]?.name,
					skipBack: cmds["meeting-scribe:audio-skip-back"]?.name,
					skipForward: cmds["meeting-scribe:audio-skip-forward"]?.name,
				};
			});
			// Obsidian prefixes command names with plugin name
			expect(names.playPause).toContain("Play/pause audio");
			expect(names.skipBack).toContain("Skip back 5 seconds");
			expect(names.skipForward).toContain("Skip forward 5 seconds");
		});
	});

	describe("Command Execution — Sidebar Open with Audio (AC #2)", function () {
		it("should execute play/pause command via Obsidian command system", async function () {
			// Execute the command
			await browser.executeObsidianCommand(
				"meeting-scribe:audio-play-pause",
			);
			await browser.pause(300);

			// Verify play button changed to pause (aria-label)
			const playBtn = await browser.$(
				".meeting-scribe-sidebar-player-play-btn",
			);
			const ariaLabel = await playBtn.getAttribute("aria-label");
			expect(ariaLabel).toBe("Pause");
		});

		it("should toggle back to paused state on second play/pause command", async function () {
			await browser.executeObsidianCommand(
				"meeting-scribe:audio-play-pause",
			);
			await browser.pause(300);

			const playBtn = await browser.$(
				".meeting-scribe-sidebar-player-play-btn",
			);
			const ariaLabel = await playBtn.getAttribute("aria-label");
			expect(ariaLabel).toBe("Play");
		});

		it("should execute skip-forward command and advance seek position", async function () {
			// Get current time before skip
			const timeBefore = await browser.execute(() => {
				const app = (window as any).app;
				const leaves = app.workspace.getLeavesOfType(
					"meeting-scribe-transcript",
				);
				if (leaves.length === 0) return 0;
				const view = leaves[0].view as any;
				return view.audioPlayer?.currentTime ?? 0;
			});

			await browser.executeObsidianCommand(
				"meeting-scribe:audio-skip-forward",
			);
			await browser.pause(300);

			const timeAfter = await browser.execute(() => {
				const app = (window as any).app;
				const leaves = app.workspace.getLeavesOfType(
					"meeting-scribe-transcript",
				);
				if (leaves.length === 0) return 0;
				const view = leaves[0].view as any;
				return view.audioPlayer?.currentTime ?? 0;
			});

			expect(timeAfter).toBeGreaterThan(timeBefore);
		});

		it("should execute skip-back command and rewind seek position", async function () {
			// First skip forward to ensure we have room to skip back
			await browser.executeObsidianCommand(
				"meeting-scribe:audio-skip-forward",
			);
			await browser.pause(200);

			const timeBefore = await browser.execute(() => {
				const app = (window as any).app;
				const leaves = app.workspace.getLeavesOfType(
					"meeting-scribe-transcript",
				);
				if (leaves.length === 0) return 0;
				const view = leaves[0].view as any;
				return view.audioPlayer?.currentTime ?? 0;
			});

			await browser.executeObsidianCommand(
				"meeting-scribe:audio-skip-back",
			);
			await browser.pause(300);

			const timeAfter = await browser.execute(() => {
				const app = (window as any).app;
				const leaves = app.workspace.getLeavesOfType(
					"meeting-scribe-transcript",
				);
				if (leaves.length === 0) return 0;
				const view = leaves[0].view as any;
				return view.audioPlayer?.currentTime ?? 0;
			});

			expect(timeAfter).toBeLessThan(timeBefore);
		});
	});

	describe("Silent No-op — Sidebar Closed or No Audio (AC #3)", function () {
		it("should not throw when executing audio commands with sidebar closed", async function () {
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

			// Execute commands — should not crash
			const noError = await browser.execute(() => {
				try {
					const app = (window as any).app;
					app.commands.executeCommandById("meeting-scribe:audio-play-pause");
					app.commands.executeCommandById("meeting-scribe:audio-skip-back");
					app.commands.executeCommandById("meeting-scribe:audio-skip-forward");
					return true;
				} catch {
					return false;
				}
			});
			expect(noError).toBe(true);
		});

		it("should not throw when sidebar is open but on session list (no audio loaded)", async function () {
			// Re-open sidebar (will show session list, no audio player)
			await browser.executeObsidianCommand(
				"meeting-scribe:open-transcript-sidebar",
			);
			await browser.pause(500);

			const noError = await browser.execute(() => {
				try {
					const app = (window as any).app;
					app.commands.executeCommandById("meeting-scribe:audio-play-pause");
					app.commands.executeCommandById("meeting-scribe:audio-skip-back");
					app.commands.executeCommandById("meeting-scribe:audio-skip-forward");
					return true;
				} catch {
					return false;
				}
			});
			expect(noError).toBe(true);
		});
	});
});
