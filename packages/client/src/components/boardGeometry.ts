export function boardDocFrame(docEl: HTMLElement) {
	return {
		left: docEl.offsetLeft,
		top: docEl.offsetTop,
		width: docEl.offsetWidth,
		height: docEl.offsetHeight,
	};
}
