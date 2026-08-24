import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
	"button:not(:disabled)",
	"[href]",
	"input:not(:disabled)",
	"select:not(:disabled)",
	"textarea:not(:disabled)",
	'[tabindex]:not([tabindex="-1"])',
].join(",");

export function useModalFocusTrap({
	open,
	containerRef,
	initialFocusRef,
	onEscape,
}: {
	open: boolean;
	containerRef: React.RefObject<HTMLElement | null>;
	initialFocusRef: React.RefObject<HTMLElement | null>;
	onEscape: () => void;
}): void {
	const escapeRef = useRef(onEscape);
	escapeRef.current = onEscape;

	useEffect(() => {
		if (!open) return;
		const returnFocus =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		const frame = requestAnimationFrame(() => initialFocusRef.current?.focus());
		const onKeyDown = (event: KeyboardEvent) =>
			handleModalKeyDown(event, containerRef.current, escapeRef.current);
		window.addEventListener("keydown", onKeyDown, true);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener("keydown", onKeyDown, true);
			if (returnFocus?.isConnected) returnFocus.focus();
		};
	}, [containerRef, initialFocusRef, open]);
}

// code-moniker: ignore[smell-feature-envy-local]
// This function is the deliberate keyboard-to-DOM adapter for the modal boundary.
function handleModalKeyDown(
	event: KeyboardEvent,
	container: HTMLElement | null,
	onEscape: () => void,
): void {
	if (event.key === "Escape") {
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		onEscape();
		return;
	}
	if (event.key !== "Tab") return;
	const focusable = Array.from(
		container?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
	).filter((element) => element.getAttribute("aria-hidden") !== "true");
	if (focusable.length === 0) {
		event.preventDefault();
		container?.focus();
		return;
	}
	const first = focusable[0];
	const last = focusable.at(-1);
	if (
		(event.shiftKey && document.activeElement === first) ||
		(!event.shiftKey && document.activeElement === last) ||
		!container?.contains(document.activeElement)
	) {
		event.preventDefault();
		(event.shiftKey ? last : first)?.focus();
	}
}
