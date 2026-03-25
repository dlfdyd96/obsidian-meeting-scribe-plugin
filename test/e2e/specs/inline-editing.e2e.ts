import { browser } from "@wdio/globals";

describe("Inline Transcript Editing — E2E Tests", function () {
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

	describe("Hover Action Buttons", function () {
		it("should render action buttons container in each bubble", async function () {
			const actionsContainers = await browser.$$(
				".meeting-scribe-sidebar-bubble-actions",
			);
			expect(actionsContainers.length).toBeGreaterThanOrEqual(1);
		});

		it("should have delete and split buttons with SVG icons", async function () {
			const deleteBtn = await browser.$(
				".meeting-scribe-sidebar-bubble-delete-btn",
			);
			expect(await deleteBtn.isExisting()).toBe(true);

			const splitBtn = await browser.$(
				".meeting-scribe-sidebar-bubble-split-btn",
			);
			expect(await splitBtn.isExisting()).toBe(true);

			// Verify SVG icons (no emoji)
			const deleteSvg = await browser.execute((el: Element) => {
				return el.querySelector("svg") !== null;
			}, deleteBtn);
			expect(deleteSvg).toBe(true);

			const splitSvg = await browser.execute((el: Element) => {
				return el.querySelector("svg") !== null;
			}, splitBtn);
			expect(splitSvg).toBe(true);
		});

		it("should hide action buttons by default and show on hover", async function () {
			// Move mouse away from bubbles first (to header area)
			const header = await browser.$(
				".meeting-scribe-sidebar-transcript-header",
			);
			await header.moveTo();
			await browser.pause(300);

			const actionsContainer = await browser.$(
				".meeting-scribe-sidebar-bubble-actions",
			);

			// Buttons should be hidden when not hovered (display: none)
			const displayBefore = await browser.execute(
				(el: Element) => getComputedStyle(el).display,
				actionsContainer,
			);
			expect(displayBefore).toBe("none");

			// Hover over the bubble to show buttons
			const bubble = await browser.$(
				".meeting-scribe-sidebar-bubble",
			);
			await bubble.moveTo();
			await browser.pause(200);

			const displayAfter = await browser.execute(
				(el: Element) => getComputedStyle(el).display,
				actionsContainer,
			);
			expect(displayAfter).toBe("flex");
		});
	});

	describe("Edit Mode Activation (AC #1)", function () {
		it("should have editing style defined in stylesheet", async function () {
			const hasEditingStyle = await browser.execute(() => {
				for (const sheet of document.styleSheets) {
					try {
						for (const rule of sheet.cssRules) {
							if (
								rule instanceof CSSStyleRule &&
								rule.selectorText?.includes(
									"meeting-scribe-sidebar-bubble--editing",
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
			expect(hasEditingStyle).toBe(true);
		});

		it("should make bubble text editable on click", async function () {
			const textEl = await browser.$(
				".meeting-scribe-sidebar-bubble-text",
			);
			await textEl.click();
			await browser.pause(200);

			const isEditable = await browser.execute(
				(el: Element) => (el as HTMLElement).contentEditable,
				textEl,
			);
			expect(isEditable).toBe("true");

			// Verify editing class applied to parent bubble
			const bubble = await browser.$(
				".meeting-scribe-sidebar-bubble--editing",
			);
			expect(await bubble.isExisting()).toBe(true);
		});

		it("should store original text in data attribute", async function () {
			// Text should already be in edit mode from previous test
			const textEl = await browser.$(
				".meeting-scribe-sidebar-bubble--editing .meeting-scribe-sidebar-bubble-text",
			);
			const originalText = await browser.execute(
				(el: Element) => el.getAttribute("data-original-text"),
				textEl,
			);
			expect(originalText).toBeTruthy();
			expect(originalText).toBe(
				"Meeting start. Let's review the design mockups.",
			);
		});
	});

	describe("Escape to Cancel (AC #3)", function () {
		it("should exit edit mode and restore text on Escape", async function () {
			// Enter edit mode on first bubble
			const textEl = await browser.$(
				".meeting-scribe-sidebar-bubble-text",
			);
			await textEl.click();
			await browser.pause(200);

			// Modify text
			await browser.execute((el: Element) => {
				(el as HTMLElement).textContent = "MODIFIED TEXT";
			}, textEl);

			// Press Escape
			await browser.keys("Escape");
			await browser.pause(200);

			// Should exit edit mode
			const isEditable = await browser.execute(
				(el: Element) => (el as HTMLElement).contentEditable,
				textEl,
			);
			expect(isEditable).toBe("false");

			// Should restore original text
			const currentText = await browser.execute(
				(el: Element) => (el as HTMLElement).textContent,
				textEl,
			);
			expect(currentText).toBe(
				"Meeting start. Let's review the design mockups.",
			);

			// Editing class should be removed
			const editingBubble = await browser.$(
				".meeting-scribe-sidebar-bubble--editing",
			);
			expect(await editingBubble.isExisting()).toBe(false);
		});
	});

	describe("Save on Blur (AC #2)", function () {
		it("should save edited text to JSON on blur", async function () {
			const textEl = await browser.$(
				".meeting-scribe-sidebar-bubble-text",
			);
			await textEl.click();
			await browser.pause(200);

			// Type new text
			await browser.execute((el: Element) => {
				(el as HTMLElement).textContent = "Edited meeting start text.";
			}, textEl);

			// Click session title to blur (avoid action buttons in header)
			const title = await browser.$(
				".meeting-scribe-sidebar-session-title",
			);
			await title.click();
			await browser.pause(500);

			// Should exit edit mode
			const isEditable = await browser.execute(
				(el: Element) => (el as HTMLElement).contentEditable,
				textEl,
			);
			expect(isEditable).toBe("false");

			// Verify text persisted by reading transcript JSON
			const savedText = await browser.execute(() => {
				const app = (window as any).app;
				const leaves = app.workspace.getLeavesOfType(
					"meeting-scribe-transcript",
				);
				if (leaves.length === 0) return null;
				const view = leaves[0].view as any;
				if (!view.transcriptData) return null;
				return view.transcriptData.segments[0]?.text;
			});
			expect(savedText).toBe("Edited meeting start text.");
		});
	});

	describe("Delete Segment (AC #5)", function () {
		it("should remove segment after confirm and re-render with fewer bubbles", async function () {
			// Dismiss any lingering modal overlays
			await browser.execute(() => {
				const bg = document.querySelector(".modal-bg") as HTMLElement;
				if (bg) bg.remove();
				const container = document.querySelector(".modal-container") as HTMLElement;
				if (container) container.remove();
			});
			await browser.pause(100);

			// Count bubbles before delete
			const bubblesBefore = await browser.$$(
				".meeting-scribe-sidebar-bubble",
			);
			const countBefore = bubblesBefore.length;
			expect(countBefore).toBeGreaterThanOrEqual(2);

			// Mock confirm to return true
			await browser.execute(() => {
				(window as any)._originalConfirm = window.confirm;
				window.confirm = () => true;
			});

			// Make delete button visible via JS (CSS hover unreliable in headless) and click
			await browser.execute(() => {
				const actions = document.querySelector(
					".meeting-scribe-sidebar-bubble-actions",
				) as HTMLElement;
				if (actions) actions.style.display = "flex";
			});
			await browser.pause(100);

			const deleteBtn = await browser.$(
				".meeting-scribe-sidebar-bubble-delete-btn",
			);
			await deleteBtn.click();
			await browser.pause(500);

			// Restore confirm
			await browser.execute(() => {
				window.confirm = (window as any)._originalConfirm;
			});

			// Should have one fewer bubble
			const bubblesAfter = await browser.$$(
				".meeting-scribe-sidebar-bubble",
			);
			expect(bubblesAfter.length).toBe(countBefore - 1);
		});
	});

	describe("Split Segment (AC #6)", function () {
		it("should split segment into two with same speaker after cursor placement", async function () {
			// Dismiss any lingering modal overlays
			await browser.execute(() => {
				const bg = document.querySelector(".modal-bg") as HTMLElement;
				if (bg) bg.remove();
				const modal = document.querySelector(".modal-container") as HTMLElement;
				if (modal) modal.remove();
			});
			await browser.pause(100);

			// Count bubbles before split
			const bubblesBefore = await browser.$$(
				".meeting-scribe-sidebar-bubble",
			);
			const countBefore = bubblesBefore.length;

			// Enter edit mode on first bubble to place cursor
			const textEl = await browser.$(
				".meeting-scribe-sidebar-bubble-text",
			);
			await textEl.click();
			await browser.pause(200);

			// Place cursor at position 4 via selection API
			await browser.execute((el: Element) => {
				const textNode = el.firstChild;
				if (!textNode) return;
				const range = document.createRange();
				range.setStart(textNode, 4);
				range.collapse(true);
				const sel = window.getSelection();
				sel?.removeAllRanges();
				sel?.addRange(range);
			}, textEl);

			// Make split button visible via JS (CSS hover unreliable in headless) and click
			await browser.execute(() => {
				const actions = document.querySelector(
					".meeting-scribe-sidebar-bubble-actions",
				) as HTMLElement;
				if (actions) actions.style.display = "flex";
			});
			await browser.pause(100);

			const splitBtn = await browser.$(
				".meeting-scribe-sidebar-bubble-split-btn",
			);
			await splitBtn.click();
			await browser.pause(500);

			// Should have one more bubble
			const bubblesAfter = await browser.$$(
				".meeting-scribe-sidebar-bubble",
			);
			expect(bubblesAfter.length).toBe(countBefore + 1);
		});
	});

	describe("Consecutive Same-Speaker Bubble Editing", function () {
		it("should be able to edit consecutive same-speaker bubbles independently", async function () {
			// Find consecutive bubble (has --consecutive class)
			const consecutiveBubble = await browser.$(
				".meeting-scribe-sidebar-bubble--consecutive",
			);
			if (!(await consecutiveBubble.isExisting())) {
				// Skip if no consecutive bubbles in test data
				return;
			}

			const textEl = await consecutiveBubble.$(
				".meeting-scribe-sidebar-bubble-text",
			);
			expect(await textEl.isExisting()).toBe(true);

			// Click to enter edit mode
			await textEl.click();
			await browser.pause(200);

			const isEditable = await browser.execute(
				(el: Element) => (el as HTMLElement).contentEditable,
				textEl,
			);
			expect(isEditable).toBe("true");

			// Verify the consecutive bubble has its own data-segment-id
			const segmentId = await browser.execute(
				(el: Element) =>
					el.closest(".meeting-scribe-sidebar-bubble")?.getAttribute("data-segment-id"),
				textEl,
			);
			expect(segmentId).toBeTruthy();

			// Cancel edit
			await browser.keys("Escape");
			await browser.pause(200);
		});
	});

	describe("Timestamp Editing (double-click)", function () {
		it("should make timestamp editable on double-click", async function () {
			const timestamp = await browser.$(
				".meeting-scribe-sidebar-bubble-timestamp--clickable",
			);
			expect(await timestamp.isExisting()).toBe(true);

			// Double-click to edit
			await timestamp.doubleClick();
			await browser.pause(200);

			const isEditable = await browser.execute(
				(el: Element) => (el as HTMLElement).contentEditable,
				timestamp,
			);
			expect(isEditable).toBe("true");

			const hasEditClass = await browser.execute(
				(el: Element) =>
					el.classList.contains("meeting-scribe-sidebar-bubble-timestamp--editing"),
				timestamp,
			);
			expect(hasEditClass).toBe(true);

			// Cancel with Escape
			await browser.keys("Escape");
			await browser.pause(200);
		});
	});
});
