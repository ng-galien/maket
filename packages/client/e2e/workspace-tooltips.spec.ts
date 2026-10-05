import {
	closeLibrary,
	createDocument,
	expect,
	openWorkspace,
	test,
} from "./workspace-test";

for (const position of ["top", "bottom"] as const) {
	test(`document bar tooltip paints above the page with the bar at the ${position}`, async ({
		mcp,
		page,
	}, testInfo) => {
		const docName = "Document tooltip";
		await openWorkspace(page);
		await closeLibrary(page);
		await page
			.getByRole("button", { name: /^(Settings|Paramètres)$/i })
			.click();
		await page
			.getByRole("group", {
				name: /Document bar position|Position de la barre du document/i,
			})
			.getByRole("button", {
				name: position === "top" ? /^(Top|En haut)$/i : /^(Bottom|En bas)$/i,
			})
			.click();
		await page
			.locator("[data-settings-page]")
			.getByRole("button", { name: /Close settings|Fermer les paramètres/i })
			.click();
		await createDocument(mcp, docName);
		await mcp.call("maket_workspace", {
			action: "focus",
			doc: docName,
			page: 1,
		});

		const document = page.locator(`[data-doc="${docName}"]`);
		const label = document.locator(".doc-label");
		const tooltip = label.locator(".doc-tooltip");
		await expect(label).toHaveAttribute("data-position", position);
		for (const zoom of ["fit", "zoomed-out"]) {
			if (zoom === "zoomed-out") {
				await document.locator(".page-canvas").hover();
				await page.mouse.wheel(0, 350);
			}
			await label.locator(".doc-label-name").hover();
			await expect(tooltip).toHaveCSS("opacity", "1");
			await expect
				.poll(() =>
					tooltip.evaluate((element) => {
						const rect = element.getBoundingClientRect();
						const x = rect.left + rect.width / 2;
						const y = rect.top + rect.height / 2;
						// Include the passive tooltip in the browser's paint-order hit test.
						const previous = element.style.pointerEvents;
						element.style.pointerEvents = "auto";
						const layers = window.document.elementsFromPoint(x, y);
						element.style.pointerEvents = previous;
						return {
							overlapsPage: layers.some((layer) =>
								layer.classList.contains("page-canvas"),
							),
							tooltipOnTop:
								layers[0] === element || element.contains(layers[0]),
						};
					}),
				)
				.toEqual({ overlapsPage: true, tooltipOnTop: true });
			await testInfo.attach(`${position}-${zoom}`, {
				body: await page.screenshot(),
				contentType: "image/png",
			});
		}
	});
}
