import type React from "react";

const hideTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

export function showLibraryScrollActivity(
	event: React.UIEvent<HTMLElement>,
): void {
	const element = event.currentTarget;
	const previousTimer = hideTimers.get(element);
	if (previousTimer) clearTimeout(previousTimer);

	element.dataset.scrolling = "true";
	hideTimers.set(
		element,
		setTimeout(() => {
			delete element.dataset.scrolling;
			hideTimers.delete(element);
		}, 700),
	);
}
