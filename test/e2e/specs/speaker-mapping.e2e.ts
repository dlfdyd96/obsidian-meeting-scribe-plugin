import { browser } from "@wdio/globals";

describe("Speaker Name Mapping — E2E Tests", function () {
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

	describe("Popover Opens on Speaker Click (AC #1)", function () {
		it("should open popover with text input when speaker name is clicked", async function () {
			const speakerEl = await browser.$(
				".meeting-scribe-sidebar-bubble-speaker",
			);
			expect(await speakerEl.isExisting()).toBe(true);

			await speakerEl.click();
			await browser.pause(300);

			// Popover should be visible
			const popover = await browser.$(
				".meeting-scribe-sidebar-speaker-popover--visible",
			);
			expect(await popover.isExisting()).toBe(true);

			// Should have a text input
			const input = await browser.$(
				".meeting-scribe-sidebar-speaker-popover-input",
			);
			expect(await input.isExisting()).toBe(true);
		});

		it("should show wiki-link checkbox defaulting to checked", async function () {
			const checkbox = await browser.$(
				".meeting-scribe-sidebar-speaker-popover-checkbox input[type='checkbox']",
			);
			expect(await checkbox.isExisting()).toBe(true);

			const isChecked = await browser.execute(
				(el: Element) => (el as HTMLInputElement).checked,
				checkbox,
			);
			expect(isChecked).toBe(true);
		});

		it("should have Cancel and Apply buttons", async function () {
			const cancelBtn = await browser.$(
				".meeting-scribe-sidebar-speaker-popover-cancel-btn",
			);
			const applyBtn = await browser.$(
				".meeting-scribe-sidebar-speaker-popover-apply-btn",
			);
			expect(await cancelBtn.isExisting()).toBe(true);
			expect(await applyBtn.isExisting()).toBe(true);
		});
	});

	describe("Vault Autocomplete (AC #1)", function () {
		it("should show autocomplete suggestions when typing", async function () {
			const input = await browser.$(
				".meeting-scribe-sidebar-speaker-popover-input",
			);

			// Clear and type a query
			await input.setValue("meet");
			await browser.pause(300);

			// Suggestions container should appear
			const suggestions = await browser.$(
				".meeting-scribe-sidebar-speaker-popover-suggestions",
			);
			const isDisplayed = await browser.execute(
				(el: Element) => getComputedStyle(el).display !== "none",
				suggestions,
			);
			expect(isDisplayed).toBe(true);
		});
	});

	describe("Apply Updates Participant and Re-renders (AC #2)", function () {
		it("should update participant name and re-render all bubbles on Apply", async function () {
			// Ensure popover is open (click speaker if needed)
			let popover = await browser.$(
				".meeting-scribe-sidebar-speaker-popover--visible",
			);
			if (!(await popover.isExisting())) {
				const speakerEl = await browser.$(
					".meeting-scribe-sidebar-bubble-speaker",
				);
				await speakerEl.click();
				await browser.pause(300);
			}

			const input = await browser.$(
				".meeting-scribe-sidebar-speaker-popover-input",
			);
			await input.setValue("Alice");

			const applyBtn = await browser.$(
				".meeting-scribe-sidebar-speaker-popover-apply-btn",
			);
			await applyBtn.click();
			await browser.pause(500);

			// Popover should close
			popover = await browser.$(
				".meeting-scribe-sidebar-speaker-popover--visible",
			);
			expect(await popover.isExisting()).toBe(false);

			// All speaker elements for this participant should show new name with wiki-link
			const speakerEls = await browser.$$(
				".meeting-scribe-sidebar-bubble-speaker",
			);
			let foundMapped = false;
			for (const el of speakerEls) {
				const text = await el.getText();
				if (text.includes("Alice")) {
					foundMapped = true;
					// Wiki-link should be enabled by default
					expect(text).toContain("[[");
					expect(text).toContain("]]");
				}
			}
			expect(foundMapped).toBe(true);

			// Verify data was saved
			const savedName = await browser.execute(() => {
				const app = (window as any).app;
				const leaves = app.workspace.getLeavesOfType(
					"meeting-scribe-transcript",
				);
				if (leaves.length === 0) return null;
				const view = leaves[0].view as any;
				if (!view.transcriptData) return null;
				return view.transcriptData.participants[0]?.name;
			});
			expect(savedName).toBe("Alice");
		});

		it("should display name as [[Name]] when wiki-link is enabled", async function () {
			// The previous test applied with wiki-link checked
			const speakerEls = await browser.$$(
				".meeting-scribe-sidebar-bubble-speaker",
			);
			for (const el of speakerEls) {
				const text = await el.getText();
				if (text.includes("Alice")) {
					expect(text).toBe("[[Alice]]");
				}
			}
		});
	});

	describe("Pre-filled for Already Mapped Speaker (AC #3)", function () {
		it("should pre-fill current name when clicking already-mapped speaker", async function () {
			// Click the mapped speaker name
			const speakerEls = await browser.$$(
				".meeting-scribe-sidebar-bubble-speaker",
			);
			let mappedSpeaker = null;
			for (const el of speakerEls) {
				const text = await el.getText();
				if (text.includes("Alice")) {
					mappedSpeaker = el;
					break;
				}
			}
			expect(mappedSpeaker).not.toBeNull();

			await mappedSpeaker!.click();
			await browser.pause(300);

			const input = await browser.$(
				".meeting-scribe-sidebar-speaker-popover-input",
			);
			const value = await browser.execute(
				(el: Element) => (el as HTMLInputElement).value,
				input,
			);
			expect(value).toBe("Alice");
		});
	});

	describe("Cancel Closes Popover Without Changes (AC #1)", function () {
		it("should close popover without saving on Cancel", async function () {
			// Popover should be open from previous test
			const input = await browser.$(
				".meeting-scribe-sidebar-speaker-popover-input",
			);
			await input.setValue("ShouldNotSave");

			const cancelBtn = await browser.$(
				".meeting-scribe-sidebar-speaker-popover-cancel-btn",
			);
			await cancelBtn.click();
			await browser.pause(300);

			// Popover should close
			const popover = await browser.$(
				".meeting-scribe-sidebar-speaker-popover--visible",
			);
			expect(await popover.isExisting()).toBe(false);

			// Name should still be Alice (unchanged)
			const savedName = await browser.execute(() => {
				const app = (window as any).app;
				const leaves = app.workspace.getLeavesOfType(
					"meeting-scribe-transcript",
				);
				if (leaves.length === 0) return null;
				const view = leaves[0].view as any;
				if (!view.transcriptData) return null;
				return view.transcriptData.participants[0]?.name;
			});
			expect(savedName).toBe("Alice");
		});
	});

	describe("Wiki-Link Toggle (AC #2)", function () {
		it("should display plain text when wiki-link is unchecked", async function () {
			// Open popover on mapped speaker
			const speakerEls = await browser.$$(
				".meeting-scribe-sidebar-bubble-speaker",
			);
			let mappedSpeaker = null;
			for (const el of speakerEls) {
				const text = await el.getText();
				if (text.includes("Alice")) {
					mappedSpeaker = el;
					break;
				}
			}
			await mappedSpeaker!.click();
			await browser.pause(300);

			// Uncheck wiki-link checkbox
			const checkbox = await browser.$(
				".meeting-scribe-sidebar-speaker-popover-checkbox input[type='checkbox']",
			);
			await checkbox.click();
			await browser.pause(100);

			// Apply
			const applyBtn = await browser.$(
				".meeting-scribe-sidebar-speaker-popover-apply-btn",
			);
			await applyBtn.click();
			await browser.pause(500);

			// Speaker should display as plain text
			const updatedSpeakers = await browser.$$(
				".meeting-scribe-sidebar-bubble-speaker",
			);
			for (const el of updatedSpeakers) {
				const text = await el.getText();
				if (text.includes("Alice")) {
					expect(text).toBe("Alice");
					expect(text).not.toContain("[[");
				}
			}

			// Verify wikiLink is false in data
			const wikiLink = await browser.execute(() => {
				const app = (window as any).app;
				const leaves = app.workspace.getLeavesOfType(
					"meeting-scribe-transcript",
				);
				if (leaves.length === 0) return null;
				const view = leaves[0].view as any;
				if (!view.transcriptData) return null;
				return view.transcriptData.participants[0]?.wikiLink;
			});
			expect(wikiLink).toBe(false);
		});
	});
});
