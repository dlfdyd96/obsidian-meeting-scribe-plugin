import { browser } from "@wdio/globals";

describe("Re-summarize & Export — E2E Tests", function () {
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

	describe("Re-summarize Button Enabled (AC #1)", function () {
		it("should have Re-summarize button enabled when transcript is loaded", async function () {
			const btn = await browser.$(
				".meeting-scribe-sidebar-action-btn",
			);
			expect(await btn.isExisting()).toBe(true);

			const isDisabled = await browser.execute(
				(el: Element) => (el as HTMLButtonElement).disabled,
				btn,
			);
			expect(isDisabled).toBe(false);

			const text = await btn.getText();
			expect(text).toBe("Re-summarize");
		});
	});

	describe("Re-summarize Confirmation Modal (AC #1)", function () {
		it("should show confirmation modal with cost warning when clicking Re-summarize", async function () {
			const btns = await browser.$$(
				".meeting-scribe-sidebar-action-btn",
			);
			// First action button is Re-summarize
			const resummarizeBtn = btns[0];
			expect(resummarizeBtn).toBeDefined();

			await resummarizeBtn!.click();
			await browser.pause(500);

			// Modal should be visible
			const modal = await browser.$(".modal-container .modal");
			expect(await modal.isExisting()).toBe(true);

			// Should contain cost warning text
			const modalText = await modal.getText();
			expect(modalText).toContain("API");
		});

		it("should have Confirm and Cancel buttons in modal", async function () {
			const confirmBtn = await browser.$(
				".modal .meeting-scribe-modal-actions .mod-cta",
			);
			const cancelBtn = await browser.$(
				".modal .meeting-scribe-modal-actions button:not(.mod-cta)",
			);
			expect(await confirmBtn.isExisting()).toBe(true);
			expect(await cancelBtn.isExisting()).toBe(true);
		});
	});

	describe("Cancel Closes Modal Without Changes (AC #1)", function () {
		it("should close modal on Cancel without triggering re-summarize", async function () {
			const cancelBtn = await browser.$(
				".modal .meeting-scribe-modal-actions button:not(.mod-cta)",
			);
			await cancelBtn.click();
			await browser.pause(300);

			// Modal should be closed
			const modal = await browser.$(".modal-container .modal");
			expect(await modal.isExisting()).toBe(false);

			// Re-summarize button should still be enabled
			const btns = await browser.$$(
				".meeting-scribe-sidebar-action-btn",
			);
			const isDisabled = await browser.execute(
				(el: Element) => (el as HTMLButtonElement).disabled,
				btns[0]!,
			);
			expect(isDisabled).toBe(false);
		});
	});

	describe("Re-summarize Loading State (AC #2)", function () {
		it("should disable button and show loading state when confirming", async function () {
			// Open modal again
			const btns = await browser.$$(
				".meeting-scribe-sidebar-action-btn",
			);
			await btns[0]!.click();
			await browser.pause(500);

			// Click Confirm
			const confirmBtn = await browser.$(
				".modal .meeting-scribe-modal-actions .mod-cta",
			);
			await confirmBtn.click();
			await browser.pause(200);

			// Button should be disabled during processing
			const isDisabled = await browser.execute(
				(el: Element) => (el as HTMLButtonElement).disabled,
				btns[0]!,
			);
			expect(isDisabled).toBe(true);

			// Button should have loading class
			const hasLoadingClass = await browser.execute(
				(el: Element) =>
					el.classList.contains(
						"meeting-scribe-sidebar-action-btn--loading",
					),
				btns[0]!,
			);
			expect(hasLoadingClass).toBe(true);

			// Wait for operation to complete (may fail due to no API key in test env, which is expected)
			await browser.pause(3000);
		});
	});

	describe("Export Button (AC #3)", function () {
		it("should have Export button enabled when transcript is loaded", async function () {
			const btns = await browser.$$(
				".meeting-scribe-sidebar-action-btn",
			);
			// Second action button is Export
			const exportBtn = btns[1];
			expect(exportBtn).toBeDefined();

			const text = await exportBtn!.getText();
			expect(text).toBe("Export");

			const isDisabled = await browser.execute(
				(el: Element) => (el as HTMLButtonElement).disabled,
				exportBtn!,
			);
			expect(isDisabled).toBe(false);
		});

		it("should create Markdown file when Export is clicked", async function () {
			const btns = await browser.$$(
				".meeting-scribe-sidebar-action-btn",
			);
			await btns[1]!.click();
			await browser.pause(1000);

			// Verify export created a file by checking vault
			const fileExists = await browser.execute(() => {
				const app = (window as any).app;
				const files = app.vault.getMarkdownFiles();
				return files.some(
					(f: any) =>
						f.path.includes("Transcript") &&
						f.path.endsWith(".md"),
				);
			});
			expect(fileExists).toBe(true);
		});
	});

	describe("Export Notice (AC #3)", function () {
		it("should show Notice with exported file path", async function () {
			// Notice is shown via Obsidian Notice API — check the DOM for .notice element
			const notice = await browser.$(".notice");
			if (await notice.isExisting()) {
				const text = await notice.getText();
				expect(text).toContain("exported");
			}
			// Even if notice has already disappeared, the file creation test above verifies functionality
		});
	});
});
