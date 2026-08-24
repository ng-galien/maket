import {
	type CSSProperties,
	type ReactNode,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 4;
const TABBABLE_SELECTOR =
	'button:not(:disabled):not([tabindex="-1"]), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export interface AnchoredMenuPosition {
	top: number;
	left: number;
	placement: "top" | "bottom";
}

export function computeAnchoredMenuPosition({
	anchor,
	menuWidth,
	menuHeight,
	viewportWidth,
	viewportHeight,
	align,
}: {
	anchor: Pick<DOMRect, "top" | "bottom" | "left" | "right">;
	menuWidth: number;
	menuHeight: number;
	viewportWidth: number;
	viewportHeight: number;
	align: "start" | "end";
}): AnchoredMenuPosition {
	const below = anchor.bottom + ANCHOR_GAP;
	const spaceBelow = viewportHeight - VIEWPORT_MARGIN - below;
	const spaceAbove = anchor.top - ANCHOR_GAP - VIEWPORT_MARGIN;
	const placement =
		menuHeight > spaceBelow && spaceAbove > spaceBelow ? "top" : "bottom";
	const desiredTop =
		placement === "top" ? anchor.top - ANCHOR_GAP - menuHeight : below;
	const desiredLeft = align === "end" ? anchor.right - menuWidth : anchor.left;
	return {
		top: clamp(
			desiredTop,
			VIEWPORT_MARGIN,
			viewportHeight - menuHeight - VIEWPORT_MARGIN,
		),
		left: clamp(
			desiredLeft,
			VIEWPORT_MARGIN,
			viewportWidth - menuWidth - VIEWPORT_MARGIN,
		),
		placement,
	};
}

export function AnchoredMenu({
	anchorRef,
	onClose,
	children,
	align = "end",
	className = "w-52",
	ariaLabel,
}: {
	anchorRef: React.RefObject<HTMLElement | null>;
	onClose: () => void;
	children: ReactNode;
	align?: "start" | "end";
	className?: string;
	ariaLabel?: string;
}) {
	const menuRef = useRef<HTMLDivElement>(null);
	const closeRef = useRef(onClose);
	const restoreFocusRef = useRef(true);
	const menuId = useId();
	const [position, setPosition] = useState<AnchoredMenuPosition | null>(null);
	closeRef.current = onClose;

	useLayoutEffect(() => {
		const anchor = anchorRef.current;
		const menu = menuRef.current;
		if (!anchor || !menu) return;
		restoreFocusRef.current = true;
		const closeWithoutRestoringFocus = () => {
			restoreFocusRef.current = false;
			closeRef.current();
		};
		const place = () => {
			const menuRect = menu.getBoundingClientRect();
			setPosition(
				computeAnchoredMenuPosition({
					anchor: anchor.getBoundingClientRect(),
					menuWidth: menuRect.width,
					menuHeight: menuRect.height,
					viewportWidth: window.innerWidth,
					viewportHeight: window.innerHeight,
					align,
				}),
			);
		};
		place();
		firstEnabledMenuItem(menu)?.focus();

		const closeFromOutside = (event: MouseEvent) => {
			if (menu.contains(event.target as Node)) return;
			if (anchor.contains(event.target as Node)) return;
			closeWithoutRestoringFocus();
		};
		const closeForViewportChange = () => closeWithoutRestoringFocus();
		document.addEventListener("mousedown", closeFromOutside);
		window.addEventListener("scroll", closeForViewportChange, true);
		window.addEventListener("resize", closeForViewportChange);
		return () => {
			document.removeEventListener("mousedown", closeFromOutside);
			window.removeEventListener("scroll", closeForViewportChange, true);
			window.removeEventListener("resize", closeForViewportChange);
			if (restoreFocusRef.current && anchor.isConnected) {
				anchor.focus({ preventScroll: true });
			}
		};
	}, [align, anchorRef]);

	const style: CSSProperties = position
		? { top: position.top, left: position.left }
		: { top: 0, left: 0, visibility: "hidden" };
	return createPortal(
		<div
			id={menuId}
			ref={menuRef}
			role="menu"
			aria-label={ariaLabel}
			data-placement={position?.placement}
			onKeyDown={(event) => {
				if (event.key === "Tab") {
					event.preventDefault();
					restoreFocusRef.current = false;
					const next = adjacentTabStop(anchorRef.current, event.shiftKey);
					closeRef.current();
					queueMicrotask(() => next?.focus({ preventScroll: true }));
					return;
				}
				if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					closeRef.current();
					return;
				}
				moveMenuFocus(event, menuRef.current);
			}}
			className={`fixed z-[var(--z-popover)] overflow-hidden rounded-md border border-border bg-panel py-1 shadow-md ${className}`}
			style={style}
		>
			{children}
		</div>,
		document.body,
	);
}

export function AnchoredMenuItem({
	icon,
	children,
	onClick,
	disabled,
	danger,
	title,
}: {
	icon?: ReactNode;
	children: ReactNode;
	onClick: () => void | Promise<void>;
	disabled?: boolean;
	danger?: boolean;
	title?: string;
}) {
	return (
		<button
			type="button"
			role="menuitem"
			tabIndex={-1}
			onClick={onClick}
			disabled={disabled}
			title={title}
			className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors ${
				disabled
					? "cursor-not-allowed text-text-3"
					: danger
						? "text-danger hover:bg-danger-soft focus-visible:bg-danger-soft"
						: "text-text-1 hover:bg-input focus-visible:bg-input"
			}`}
		>
			{icon && <span className="flex-shrink-0">{icon}</span>}
			<span className="min-w-0 flex-1 truncate">{children}</span>
		</button>
	);
}

function moveMenuFocus(
	event: React.KeyboardEvent<HTMLDivElement>,
	menu: HTMLDivElement | null,
): void {
	if (!menu || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
		return;
	const items = enabledMenuItems(menu);
	if (items.length === 0) return;
	event.preventDefault();
	const current = items.indexOf(document.activeElement as HTMLButtonElement);
	if (event.key === "Home") items[0]?.focus();
	else if (event.key === "End") items.at(-1)?.focus();
	else if (event.key === "ArrowDown")
		items[(current + 1) % items.length]?.focus();
	else items[(current <= 0 ? items.length : current) - 1]?.focus();
}

function firstEnabledMenuItem(menu: HTMLDivElement): HTMLButtonElement | null {
	return enabledMenuItems(menu)[0] ?? null;
}

function enabledMenuItems(menu: HTMLDivElement): HTMLButtonElement[] {
	return Array.from(
		menu.querySelectorAll<HTMLButtonElement>(
			'[role="menuitem"]:not(:disabled)',
		),
	);
}

function adjacentTabStop(
	anchor: HTMLElement | null,
	backwards: boolean,
): HTMLElement | null {
	if (!anchor) return null;
	const stops = Array.from(
		document.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR),
	).filter(
		(element) =>
			element.isConnected && element.getAttribute("aria-hidden") !== "true",
	);
	const anchorIndex = stops.indexOf(anchor);
	if (anchorIndex < 0) return null;
	return stops[anchorIndex + (backwards ? -1 : 1)] ?? null;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(Math.max(min, max), value));
}
