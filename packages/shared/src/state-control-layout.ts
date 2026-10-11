/**
 * Grow or shrink a bound textarea to its content. The textarea's own CSS
 * `min-height` (or its `rows`) and `max-height` bound the height; beyond the
 * maximum the textarea scrolls.
 */
export function fitBoundTextareaHeight(textarea: HTMLTextAreaElement): void {
	textarea.style.height = "auto";
	const style = getComputedStyle(textarea);
	const borders =
		style.boxSizing === "border-box"
			? (Number.parseFloat(style.borderTopWidth) || 0) +
				(Number.parseFloat(style.borderBottomWidth) || 0)
			: 0;
	textarea.style.height = `${textarea.scrollHeight + borders}px`;
}
