import { browser } from "@wdio/globals";

describe("Playback-Transcript Synchronization — E2E Tests", function () {
	before(async function () {
		await browser.reloadObsidian({ vault: "./test/e2e/vaults/basic" });
		await browser.pause(2000);

		// Open sidebar and navigate to transcript view
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

	describe("Segment Data Attributes", function () {
		it("should have data-segment-id, data-segment-start, data-segment-end on each bubble", async function () {
			const bubbles = await browser.$$(
				".meeting-scribe-sidebar-bubble",
			);
			expect(bubbles.length).toBeGreaterThanOrEqual(1);

			// Check first bubble has all required data attributes
			const firstBubble = bubbles[0]!;
			const segId = await firstBubble.getAttribute("data-segment-id");
			const segStart = await firstBubble.getAttribute("data-segment-start");
			const segEnd = await firstBubble.getAttribute("data-segment-end");

			expect(segId).toBeTruthy();
			expect(segStart).not.toBeNull();
			expect(segEnd).not.toBeNull();
			expect(parseFloat(segStart!)).not.toBeNaN();
			expect(parseFloat(segEnd!)).not.toBeNaN();
		});

		it("should have data-start attribute on each timestamp span", async function () {
			const timestamps = await browser.$$(
				".meeting-scribe-sidebar-bubble-timestamp--clickable",
			);
			expect(timestamps.length).toBeGreaterThanOrEqual(1);

			const dataStart = await timestamps[0]!.getAttribute("data-start");
			expect(dataStart).not.toBeNull();
			expect(parseFloat(dataStart!)).not.toBeNaN();
		});

		it("should set --speaker-border-color CSS variable on bubbles", async function () {
			const bubble = await browser.$(
				".meeting-scribe-sidebar-bubble",
			);
			const borderColor = await browser.execute(
				(el: Element) => {
					return (el as HTMLElement).style.getPropertyValue(
						"--speaker-border-color",
					);
				},
				bubble,
			);
			expect(borderColor).toMatch(/^hsl\(/);
		});
	});

	describe("Highlight Active State CSS", function () {
		it("should have .meeting-scribe-sidebar-bubble--active style defined in stylesheet", async function () {
			const hasActiveStyle = await browser.execute(() => {
				for (const sheet of document.styleSheets) {
					try {
						for (const rule of sheet.cssRules) {
							if (
								rule instanceof CSSStyleRule &&
								rule.selectorText?.includes(
									"meeting-scribe-sidebar-bubble--active",
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
			expect(hasActiveStyle).toBe(true);
		});

		it("should have clickable timestamp hover style defined in stylesheet", async function () {
			const hasClickableStyle = await browser.execute(() => {
				for (const sheet of document.styleSheets) {
					try {
						for (const rule of sheet.cssRules) {
							if (
								rule instanceof CSSStyleRule &&
								rule.selectorText?.includes(
									"meeting-scribe-sidebar-bubble-timestamp--clickable",
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
			expect(hasClickableStyle).toBe(true);
		});
	});

	describe("Timestamp Click to Seek", function () {
		it("should have cursor: pointer on clickable timestamps", async function () {
			const timestamp = await browser.$(
				".meeting-scribe-sidebar-bubble-timestamp--clickable",
			);
			const cursor = await browser.execute(
				(el: Element) => getComputedStyle(el).cursor,
				timestamp,
			);
			expect(cursor).toBe("pointer");
		});

		it("should seek audio when clicking a timestamp", async function () {
			// Click the second timestamp (Participant 2, start=16)
			const timestamps = await browser.$$(
				".meeting-scribe-sidebar-bubble-timestamp--clickable",
			);
			expect(timestamps.length).toBeGreaterThanOrEqual(2);

			await timestamps[1]!.click();
			await browser.pause(500);

			// Verify audio player has seeked by checking seek bar moved
			// The seek fill should have a non-zero width
			const seekFill = await browser.$(
				".meeting-scribe-sidebar-player-seek-fill",
			);
			const width = await browser.execute(
				(el: Element) => (el as HTMLElement).style.width,
				seekFill,
			);
			// Width should be non-empty and non-zero since we seeked to 16s out of 450s
			expect(width).toBeTruthy();
			expect(width).not.toBe("0%");
		});
	});

	describe("Playback Highlight Activation", function () {
		it("should highlight a bubble when audio plays at matching timestamp", async function () {
			// Call handleTimeUpdate directly on the view to simulate playback sync
			// (avoids audio duration clamping issues with unloaded audio metadata)
			await browser.execute(() => {
				const app = (window as any).app;
				const leaves = app.workspace.getLeavesOfType(
					"meeting-scribe-transcript",
				);
				if (leaves.length === 0) return;
				const view = leaves[0].view as any;
				if (view.handleTimeUpdate) {
					view.handleTimeUpdate(5); // Mid-segment 1 (0-15)
				}
			});
			await browser.pause(300);

			const activeBubble = await browser.$(
				".meeting-scribe-sidebar-bubble--active",
			);
			expect(await activeBubble.isExisting()).toBe(true);
		});

		it("should move highlight to different bubble when time changes", async function () {
			// Call handleTimeUpdate directly on the view to avoid audio duration clamping
			await browser.execute(() => {
				const app = (window as any).app;
				const leaves = app.workspace.getLeavesOfType(
					"meeting-scribe-transcript",
				);
				if (leaves.length === 0) return;
				const view = leaves[0].view as any;
				if (view.handleTimeUpdate) {
					view.handleTimeUpdate(20); // Mid-segment 2 (16-30)
				}
			});
			await browser.pause(300);

			// Only one bubble should be active
			const activeBubbles = await browser.$$(
				".meeting-scribe-sidebar-bubble--active",
			);
			expect(activeBubbles.length).toBe(1);

			// The active bubble should be the second one (segment 2)
			const bubbles = await browser.$$(
				".meeting-scribe-sidebar-bubble",
			);
			const secondBubbleId = await bubbles[1]!.getAttribute(
				"data-segment-id",
			);
			const activeBubbleId = await activeBubbles[0]!.getAttribute(
				"data-segment-id",
			);
			expect(activeBubbleId).toBe(secondBubbleId);
		});

		it("should remove highlight when time is outside all segments", async function () {
			// Call handleTimeUpdate with a time beyond all segments
			await browser.execute(() => {
				const app = (window as any).app;
				const leaves = app.workspace.getLeavesOfType(
					"meeting-scribe-transcript",
				);
				if (leaves.length === 0) return;
				const view = leaves[0].view as any;
				if (view.handleTimeUpdate) {
					view.handleTimeUpdate(100); // Beyond all segments (last ends at 90)
				}
			});
			await browser.pause(300);

			const activeBubbles = await browser.$$(
				".meeting-scribe-sidebar-bubble--active",
			);
			expect(activeBubbles.length).toBe(0);
		});
	});

	describe("Scroll Container", function () {
		it("should have scroll event listener on transcript scroll container", async function () {
			const scrollContainer = await browser.$(
				".meeting-scribe-sidebar-transcript-scroll",
			);
			expect(await scrollContainer.isExisting()).toBe(true);

			// Verify the scroll container has overflow-y for scrolling
			const overflowY = await browser.execute(
				(el: Element) => getComputedStyle(el).overflowY,
				scrollContainer,
			);
			expect(["auto", "scroll"]).toContain(overflowY);
		});
	});

	describe("Bubble Border Stability (L1 fix)", function () {
		it("should have transparent border-left on default (non-active) bubbles to prevent content shift", async function () {
			// Ensure no bubble is currently active by clearing highlight
			await browser.execute(() => {
				const app = (window as any).app;
				const leaves = app.workspace.getLeavesOfType(
					"meeting-scribe-transcript",
				);
				if (leaves.length === 0) return;
				const view = leaves[0].view as any;
				if (view.handleTimeUpdate) {
					view.handleTimeUpdate(9999); // Beyond all segments — clears highlight
				}
			});
			await browser.pause(300);

			const bubble = await browser.$(
				".meeting-scribe-sidebar-bubble",
			);
			const borderLeft = await browser.execute(
				(el: Element) => getComputedStyle(el).borderLeftWidth,
				bubble,
			);
			// Default bubble should have 4px border-left (transparent) to match active state width
			expect(borderLeft).toBe("4px");
		});

		it("should not shift content when bubble becomes active", async function () {
			const bubble = await browser.$(
				".meeting-scribe-sidebar-bubble",
			);

			// Measure width before activation
			const widthBefore = await browser.execute(
				(el: Element) => (el as HTMLElement).offsetWidth,
				bubble,
			);

			// Activate the first bubble
			await browser.execute(() => {
				const app = (window as any).app;
				const leaves = app.workspace.getLeavesOfType(
					"meeting-scribe-transcript",
				);
				if (leaves.length === 0) return;
				const view = leaves[0].view as any;
				if (view.handleTimeUpdate) {
					view.handleTimeUpdate(5);
				}
			});
			await browser.pause(300);

			// Measure width after activation
			const widthAfter = await browser.execute(
				(el: Element) => (el as HTMLElement).offsetWidth,
				bubble,
			);

			// Width should remain the same (no content shift)
			expect(widthAfter).toBe(widthBefore);
		});
	});

	describe("Programmatic Scroll Resilience (M1 fix)", function () {
		it("should not pause auto-scroll when programmatic scroll fires multiple events", async function () {
			// This test verifies that the programmaticScroll flag stays true
			// for 400ms after scrollIntoView, preventing false manual scroll detection.
			const result = await browser.execute(() => {
				const app = (window as any).app;
				const leaves = app.workspace.getLeavesOfType(
					"meeting-scribe-transcript",
				);
				if (leaves.length === 0) return { error: "no leaves" };
				const view = leaves[0].view as any;

				// Trigger highlight on segment 1 — this sets programmaticScroll = true
				if (view.handleTimeUpdate) {
					view.handleTimeUpdate(5);
				}

				// Simulate rapid scroll events (as smooth scroll animation would fire)
				const scrollContainer = view.scrollContainer;
				if (!scrollContainer) return { error: "no scrollContainer" };

				scrollContainer.dispatchEvent(new Event("scroll"));
				scrollContainer.dispatchEvent(new Event("scroll"));
				scrollContainer.dispatchEvent(new Event("scroll"));

				// Check autoScrollEnabled is still true (not paused by programmatic scroll events)
				return { autoScrollEnabled: view.autoScrollEnabled };
			});

			expect(result).toHaveProperty("autoScrollEnabled", true);
		});
	});
});
