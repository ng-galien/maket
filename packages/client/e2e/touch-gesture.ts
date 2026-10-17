import type { CDPSession, Page } from "@playwright/test";

/** Send a finger path within the viewport, including compositor frames between
 * moves. Exercise native touch scrolling with an explicit path rather than a
 * synthesized scroll command, including when a pinch preceded the swipe. */
export async function swipeTouch(
	page: Page,
	session: CDPSession,
	from: { x: number; y: number },
	to: { x: number; y: number },
) {
	await session.send("Input.dispatchTouchEvent", {
		type: "touchStart",
		touchPoints: [{ ...from, id: 1 }],
	});
	for (let step = 1; step <= 12; step++) {
		await session.send("Input.dispatchTouchEvent", {
			type: "touchMove",
			touchPoints: [
				{
					x: from.x + ((to.x - from.x) * step) / 12,
					y: from.y + ((to.y - from.y) * step) / 12,
					id: 1,
				},
			],
		});
		await page.evaluate(
			() =>
				new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
		);
	}
	await session.send("Input.dispatchTouchEvent", {
		type: "touchEnd",
		touchPoints: [],
	});
}
