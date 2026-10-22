import type { Page, WebSocketRoute } from "@playwright/test";
import {
	createDocument,
	expect,
	openLibraryView,
	openWorkspace,
	test,
} from "./workspace-test";

test.use({ isMobile: true, hasTouch: true });

/** Puts the page's Maket socket behind a switchable network: `cut` refuses
 * every connection, `silence` keeps the current socket open but carrying
 * nothing, as after a phone wakes up with a dead connection. */
async function controlledNetwork(page: Page) {
	let online = true;
	const live = new Set<WebSocketRoute>();
	const silent = new Set<WebSocketRoute>();
	let checks = 0;
	await page.routeWebSocket(/^wss?:\/\/[^/]+\/(ws)?(\?.*)?$/, (client) => {
		if (!online) {
			client.close();
			return;
		}
		const server = client.connectToServer();
		live.add(client);
		client.onMessage((message) => {
			if (String(message).includes('"connection_check"')) checks += 1;
			if (!silent.has(client)) server.send(message);
		});
		server.onMessage((message) => {
			if (!silent.has(client)) client.send(message);
		});
		client.onClose(() => live.delete(client));
	});
	return {
		cut() {
			online = false;
			for (const client of live) client.close();
		},
		restore() {
			online = true;
		},
		silence() {
			for (const client of live) silent.add(client);
		},
		checks: () => checks,
	};
}

async function setVisibility(page: Page, state: "hidden" | "visible") {
	await page.evaluate((visibility) => {
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			get: () => visibility,
		});
		document.dispatchEvent(new Event("visibilitychange"));
	}, state);
}

async function createLongDocument(
	mcp: Parameters<typeof createDocument>[0],
	doc: string,
) {
	await createDocument(mcp, doc, {
		html: `<main data-id="body" style="height:1000px"><h1 data-id="title">${doc} page 1</h1></main>`,
	});
	for (const page of [2, 3])
		await mcp.call("maket_page", {
			action: "add",
			doc,
			name: `P${page}`,
			html: `<main data-id="body${page}" style="height:1000px"><h1 data-id="t${page}">${doc} page ${page}</h1></main>`,
		});
}

async function openFromLibrary(page: Page, doc: string) {
	const library = await openLibraryView(page, "docs");
	await library.getByRole("searchbox").fill(doc);
	await library.getByRole("button", { name: doc, exact: true }).tap();
	await expect(page.locator("[data-library-panel]")).toBeHidden();
	await expect(readerPage(page, doc, 0)).toBeVisible();
}

function readerPage(page: Page, doc: string, logicalIndex: number) {
	return page.locator(
		`[data-reading-workspace] [data-doc="${doc}"] [data-reader-page-index="${logicalIndex}"]`,
	);
}

/** Distance from page 2's top to the reader's top, in page heights. */
async function readingPosition(page: Page, doc: string) {
	return readerPage(page, doc, 1).evaluate((element) => {
		const root = element.closest("[data-reading-workspace]") as HTMLElement;
		const bounds = element.getBoundingClientRect();
		return (root.getBoundingClientRect().top - bounds.top) / bounds.height;
	});
}

async function scrollIntoPageTwo(page: Page, doc: string) {
	await readerPage(page, doc, 1).evaluate((element) => {
		const root = element.closest("[data-reading-workspace]") as HTMLElement;
		const bounds = element.getBoundingClientRect();
		root.scrollTop +=
			bounds.top - root.getBoundingClientRect().top + bounds.height * 0.5;
	});
	await expect.poll(() => readingPosition(page, doc)).toBeCloseTo(0.5, 1);
	// The reader remembers its offset once scrolling settles.
	await page.waitForTimeout(400);
}

/** Every step of the Back stack, from the current entry to the first. */
async function walkBack(page: Page) {
	const steps: string[] = [];
	const describe = () =>
		page.evaluate(() => {
			const entry = history.state?.maketMobileNavigation;
			const shell = entry?.snapshot?.shell ?? {};
			return `${entry?.index}:${shell.libraryOpen ? `library:${shell.libraryView}` : shell.focusedDocName}`;
		});
	steps.push(await describe());
	while (
		await page.evaluate(() => history.state?.maketMobileNavigation?.index > 0)
	) {
		await page.goBack();
		await page.waitForTimeout(200);
		steps.push(await describe());
	}
	return steps;
}

const indicator = (page: Page) =>
	page.locator('[role="status"][aria-label^="Maket"]').first();

for (const pause of ["network cut of 10 s", "2 minutes in the background"]) {
	test(`the mobile reader resumes its reading after a ${pause}`, async ({
		page,
		mcp,
	}) => {
		await page.setViewportSize({ width: 390, height: 800 });
		await createLongDocument(mcp, "TEST reconnect A");
		await createLongDocument(mcp, "TEST reconnect B");
		const network = await controlledNetwork(page);
		await page.clock.install();
		await openWorkspace(page);
		await openFromLibrary(page, "TEST reconnect A");
		await openFromLibrary(page, "TEST reconnect B");
		await scrollIntoPageTwo(page, "TEST reconnect B");
		const surface = await page
			.locator("[data-reading-workspace]")
			.elementHandle();
		const stackIndex = await page.evaluate(
			() => history.state.maketMobileNavigation.index,
		);
		await expect(indicator(page)).toHaveAttribute(
			"aria-label",
			"Maket connected",
		);
		const bubbles = page.locator("[data-maket-activity]");

		if (pause === "network cut of 10 s") {
			network.cut();
			await expect(indicator(page)).toHaveAttribute(
				"aria-label",
				"Maket disconnected",
			);
			await page.clock.runFor(10_000);
			network.restore();
			await page.clock.runFor(2_000);
		} else {
			await setVisibility(page, "hidden");
			network.silence();
			await page.clock.fastForward(120_000);
			await setVisibility(page, "visible");
			await expect.poll(() => network.checks()).toBeGreaterThan(0);
			await page.clock.runFor(3_000);
			await expect(indicator(page)).toHaveAttribute(
				"aria-label",
				"Maket disconnected",
			);
			await page.clock.runFor(100);
		}

		await expect(indicator(page)).toHaveAttribute(
			"aria-label",
			"Maket connected",
		);
		await page.clock.runFor(1_000);
		await expect(readerPage(page, "TEST reconnect B", 1)).toBeVisible();
		expect(await readingPosition(page, "TEST reconnect B")).toBeCloseTo(0.5, 1);
		expect(
			await page
				.locator("[data-reading-workspace]")
				.evaluate((element, held) => element === held, surface),
		).toBe(true);
		await expect(bubbles).toHaveCount(0);
		expect(
			await page.evaluate(() => history.state.maketMobileNavigation.index),
		).toBe(stackIndex);

		const steps = await walkBack(page);
		expect(steps).toEqual([
			`${stackIndex}:TEST reconnect B`,
			`${stackIndex - 1}:library:docs`,
			`${stackIndex - 2}:TEST reconnect A`,
			`${stackIndex - 3}:library:docs`,
		]);
		expect(stackIndex).toBe(3);
	});
}

test("a cold relaunch reopens the last document at the last page and offset", async ({
	page,
	mcp,
}) => {
	await page.setViewportSize({ width: 390, height: 800 });
	await createLongDocument(mcp, "TEST relaunch A");
	await createLongDocument(mcp, "TEST relaunch B");
	await openWorkspace(page);
	await openFromLibrary(page, "TEST relaunch A");
	await openFromLibrary(page, "TEST relaunch B");
	await scrollIntoPageTwo(page, "TEST relaunch B");
	await page.close();

	const relaunched = await page.context().newPage();
	await relaunched.setViewportSize({ width: 390, height: 800 });
	await openWorkspace(relaunched);
	await expect(readerPage(relaunched, "TEST relaunch B", 1)).toBeVisible();
	await expect
		.poll(() => readingPosition(relaunched, "TEST relaunch B"))
		.toBeCloseTo(0.5, 1);
	await expect(indicator(relaunched)).toHaveAttribute(
		"aria-label",
		"Maket connected",
	);
	expect(
		await relaunched.evaluate(() => history.state.maketMobileNavigation.index),
	).toBe(1);
	await relaunched.goBack();
	await expect(relaunched.locator("[data-library-panel]")).toBeVisible();
	await expect(relaunched).toHaveURL(/\/$/);
	expect(
		await relaunched.evaluate(() => history.state.maketMobileNavigation.index),
	).toBe(0);
});

test("a note draft survives a cut, and a note lost in the cut says so", async ({
	page,
	mcp,
}) => {
	await page.setViewportSize({ width: 390, height: 800 });
	await createDocument(mcp, "TEST reconnect note");
	const network = await controlledNetwork(page);
	await openWorkspace(page);
	await openFromLibrary(page, "TEST reconnect note");
	const panel = await openLibraryView(page, "exchange");
	await panel
		.getByRole("button", { name: "Write a message", exact: true })
		.click();
	const composer = page.locator("[data-mobile-message-composer]");
	await composer.getByRole("textbox").fill("Draft kept across the cut");

	network.cut();
	await expect(composer).toContainText("Maket disconnected");
	await expect(
		composer.getByRole("button", { name: "Send", exact: true }),
	).toBeDisabled();
	network.restore();
	await expect(composer).not.toContainText("Maket disconnected", {
		timeout: 10_000,
	});
	await expect(
		composer.getByRole("button", { name: "Send", exact: true }),
	).toBeEnabled();
	await expect(composer.getByRole("textbox")).toHaveValue(
		"Draft kept across the cut",
	);

	network.silence();
	await composer.getByRole("button", { name: "Send", exact: true }).click();
	network.cut();
	await expect(composer).toContainText(
		"The connection closed before the note was saved.",
	);
	network.restore();
	await expect(
		composer.getByRole("button", { name: "Send", exact: true }),
	).toBeEnabled({ timeout: 10_000 });
	await expect(composer.getByRole("textbox")).toHaveValue(
		"Draft kept across the cut",
	);
});
