export function boardDocFrame(docEl: HTMLElement, board?: HTMLElement) {
	let left = 0;
	let top = 0;
	let element: HTMLElement | null = docEl;
	while (element && element !== board) {
		left += element.offsetLeft;
		top += element.offsetTop;
		element = element.offsetParent as HTMLElement | null;
	}
	return { left, top, width: docEl.offsetWidth, height: docEl.offsetHeight };
}
