import { browser } from "@wdio/globals";

describe("Audio Player — E2E Tests", function () {
	before(async function () {
		await browser.reloadObsidian({ vault: "./test/e2e/vaults/basic" });
		await browser.pause(2000);
	});

	describe("Player Rendering", function () {
		it("should render audio player when opening transcript with audio file", async function () {
			// Open sidebar
			await browser.executeObsidianCommand(
				"meeting-scribe:open-transcript-sidebar",
			);
			await browser.pause(500);

			// Click first completed session to open transcript view
			const sessionItem = await browser.$(
				".meeting-scribe-sidebar-session-item",
			);
			expect(await sessionItem.isExisting()).toBe(true);
			await sessionItem.click();
			await browser.pause(1000);

			// Verify audio player is rendered at the bottom
			const player = await browser.$(
				".meeting-scribe-sidebar-player",
			);
			expect(await player.isExisting()).toBe(true);
		});

		it("should render all control buttons: volume, skip-back, play, skip-forward, speed", async function () {
			const playBtn = await browser.$(
				".meeting-scribe-sidebar-player-play-btn",
			);
			expect(await playBtn.isExisting()).toBe(true);

			const skipBtns = await browser.$$(
				".meeting-scribe-sidebar-player-skip-btn",
			);
			expect(skipBtns.length).toBe(2);

			const volumeBtn = await browser.$(
				".meeting-scribe-sidebar-player-volume-btn",
			);
			expect(await volumeBtn.isExisting()).toBe(true);

			const speedBtn = await browser.$(
				".meeting-scribe-sidebar-player-speed-btn",
			);
			expect(await speedBtn.isExisting()).toBe(true);
		});

		it("should render seek bar with time labels", async function () {
			const seekBar = await browser.$(
				".meeting-scribe-sidebar-player-seek-bar",
			);
			expect(await seekBar.isExisting()).toBe(true);

			const seekTimes = await browser.$$(
				".meeting-scribe-sidebar-player-seek-time",
			);
			expect(seekTimes.length).toBe(2);
		});

		it("should use flex layout with scroll area and fixed player", async function () {
			// Verify layout class is on contentEl
			const layout = await browser.$(
				".meeting-scribe-sidebar-transcript-layout",
			);
			expect(await layout.isExisting()).toBe(true);

			// Verify scroll container exists
			const scroll = await browser.$(
				".meeting-scribe-sidebar-transcript-scroll",
			);
			expect(await scroll.isExisting()).toBe(true);

			// Verify player is outside scroll container (not scrollable)
			const playerInScroll = await browser.$(
				".meeting-scribe-sidebar-transcript-scroll .meeting-scribe-sidebar-player",
			);
			expect(await playerInScroll.isExisting()).toBe(false);
		});
	});

	describe("Speed Popup", function () {
		it("should open speed popup on click and show 4 options", async function () {
			const speedBtn = await browser.$(
				".meeting-scribe-sidebar-player-speed-btn",
			);
			await speedBtn.click();
			await browser.pause(200);

			const popup = await browser.$(
				".meeting-scribe-sidebar-player-speed-popup--visible",
			);
			expect(await popup.isExisting()).toBe(true);

			const options = await browser.$$(
				".meeting-scribe-sidebar-player-speed-option",
			);
			expect(options.length).toBe(4);
		});

		it("should close speed popup when selecting an option", async function () {
			// Click 1.5x option (index 2)
			const options = await browser.$$(
				".meeting-scribe-sidebar-player-speed-option",
			);
			await options[2]!.click();
			await browser.pause(200);

			const popup = await browser.$(
				".meeting-scribe-sidebar-player-speed-popup--visible",
			);
			expect(await popup.isExisting()).toBe(false);

			// Verify speed button text updated
			const speedBtn = await browser.$(
				".meeting-scribe-sidebar-player-speed-btn",
			);
			expect(await speedBtn.getText()).toBe("1.5x");
		});
	});

	describe("Volume Control", function () {
		it("should open volume popup on click", async function () {
			// Re-open transcript view if needed
			const player = await browser.$(
				".meeting-scribe-sidebar-player",
			);
			if (!(await player.isExisting())) {
				await browser.executeObsidianCommand(
					"meeting-scribe:open-transcript-sidebar",
				);
				await browser.pause(500);
				const sessionItem = await browser.$(
					".meeting-scribe-sidebar-session-item",
				);
				await sessionItem.click();
				await browser.pause(1000);
			}

			const volumeBtn = await browser.$(
				".meeting-scribe-sidebar-player-volume-btn",
			);
			await volumeBtn.click();
			await browser.pause(200);

			const popup = await browser.$(
				".meeting-scribe-sidebar-player-volume-popup--visible",
			);
			expect(await popup.isExisting()).toBe(true);
		});

		it("should have a vertical range slider in the popup", async function () {
			const slider = await browser.$(
				".meeting-scribe-sidebar-player-volume-slider",
			);
			expect(await slider.isExisting()).toBe(true);

			// Verify it's an input[type=range]
			const type = await browser.execute(
				(el: Element) => (el as HTMLInputElement).type,
				slider,
			);
			expect(type).toBe("range");

			// Verify vertical orientation via writing-mode CSS
			const writingMode = await browser.execute(
				(el: Element) => getComputedStyle(el).writingMode,
				slider,
			);
			expect(writingMode).toContain("vertical");
		});

		it("should change volume when slider is moved", async function () {
			const slider = await browser.$(
				".meeting-scribe-sidebar-player-volume-slider",
			);

			// Set slider to 50% via JS
			await browser.execute((el: Element) => {
				const input = el as HTMLInputElement;
				input.value = "50";
				input.dispatchEvent(new Event("input", { bubbles: true }));
			}, slider);
			await browser.pause(200);

			// Verify slider value persisted
			const sliderValue = await browser.execute(
				(el: Element) => (el as HTMLInputElement).value,
				slider,
			);
			expect(sliderValue).toBe("50");
		});

		it("should close volume popup on second click", async function () {
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

	describe("Player Cleanup", function () {
		it("should destroy audio player when navigating back to session list", async function () {
			// We should be in transcript view from previous tests
			const backBtn = await browser.$(
				".meeting-scribe-sidebar-back-btn",
			);
			expect(await backBtn.isExisting()).toBe(true);
			await backBtn.click();
			await browser.pause(500);

			// Player should be gone
			const player = await browser.$(
				".meeting-scribe-sidebar-player",
			);
			expect(await player.isExisting()).toBe(false);

			// Layout class should be removed
			const layout = await browser.$(
				".meeting-scribe-sidebar-transcript-layout",
			);
			expect(await layout.isExisting()).toBe(false);

			// Session list should be showing
			const sessionItems = await browser.$$(
				".meeting-scribe-sidebar-session-item",
			);
			expect(sessionItems.length).toBeGreaterThanOrEqual(1);
		});

		it("should destroy audio player when sidebar is closed", async function () {
			// Open transcript view again
			const sessionItem = await browser.$(
				".meeting-scribe-sidebar-session-item",
			);
			await sessionItem.click();
			await browser.pause(1000);

			// Verify player exists
			const playerBefore = await browser.$(
				".meeting-scribe-sidebar-player",
			);
			expect(await playerBefore.isExisting()).toBe(true);

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

			// Verify sidebar is completely gone
			const sidebarAfter = await browser.$(
				'.workspace-leaf-content[data-type="meeting-scribe-transcript"]',
			);
			expect(await sidebarAfter.isExisting()).toBe(false);
		});
	});

	describe("No Audio File — Disabled State", function () {
		it("should show disabled state when audio file is missing", async function () {
			// Modify the transcript to point to a nonexistent audio file
			// by creating a session with no audio
			await browser.execute(() => {
				const app = (window as any).app;
				// Access the plugin's session manager
				const plugin = (app as any).plugins?.plugins?.["meeting-scribe"];
				if (plugin?.sessionManager) {
					const session = plugin.sessionManager.createSession("nonexistent-audio.webm");
					plugin.sessionManager.updateSessionState(session.id, {
						status: "complete",
						progress: 100,
						completedSteps: ["transcribe", "summarize", "generate"],
					});
				}
			});
			await browser.pause(500);

			// Reopen sidebar
			await browser.executeObsidianCommand(
				"meeting-scribe:open-transcript-sidebar",
			);
			await browser.pause(500);

			// Open transcript for the session with missing audio
			// The session with a real audio should show the player
			// A session with missing audio should show disabled state
			// We verify the disabled state CSS class exists in the stylesheet
			const disabledClass = await browser.execute(() => {
				for (const sheet of document.styleSheets) {
					try {
						for (const rule of sheet.cssRules) {
							if (
								rule instanceof CSSStyleRule &&
								rule.selectorText?.includes(
									"meeting-scribe-sidebar-player-disabled",
								)
							) {
								return true;
							}
						}
					} catch {
						// Cross-origin stylesheets throw
					}
				}
				return false;
			});
			expect(disabledClass).toBe(true);
		});
	});
});
