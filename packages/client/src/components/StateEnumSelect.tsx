import { Check } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

export interface StateEnumOption {
	value: string;
	label: string;
}

export interface StateEnumSelectState {
	pointer: string;
	anchorIndex: number;
	anchorRect: Pick<DOMRect, "top" | "bottom" | "left" | "width">;
	options: StateEnumOption[];
	selectedValue: string;
	label: string;
}

interface Props {
	state: StateEnumSelectState;
	root: HTMLElement;
	onCancel: (restoreFocus: boolean) => void;
	onSubmit: (value: string) => void;
}

interface PopoverPosition {
	top: number;
	left: number;
	width: number;
	maxHeight: number;
}

export function StateEnumSelect({ state, root, onCancel, onSubmit }: Props) {
	const listboxId = useId();
	const selectedIndex = Math.max(
		0,
		state.options.findIndex((option) => option.value === state.selectedValue),
	);
	const [activeIndex, setActiveIndex] = useState(selectedIndex);
	const [position, setPosition] = useState<PopoverPosition>(() => {
		const anchor = findStateEnumAnchor(root, state);
		return positionEnumPopover(
			anchor?.getBoundingClientRect() ?? state.anchorRect,
			state.options.length,
		);
	});
	const listRef = useRef<HTMLDivElement>(null);
	const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
	useLayoutEffect(() => {
		const anchor = findStateEnumAnchor(root, state);
		if (!anchor) return;
		anchor.setAttribute("aria-expanded", "true");
		anchor.setAttribute("aria-controls", listboxId);
		return () => {
			anchor.setAttribute("aria-expanded", "false");
			anchor.removeAttribute("aria-controls");
		};
	}, [listboxId, root, state]);
	useLayoutEffect(() => {
		optionRefs.current[activeIndex]?.focus();
	}, [activeIndex]);
	useEffect(() => {
		let frame = 0;
		const updatePosition = () => {
			const anchor = findStateEnumAnchor(root, state);
			if (!anchor) {
				onCancel(false);
				return;
			}
			const anchorRect = anchor.getBoundingClientRect();
			if (!enumAnchorIntersectsViewport(anchorRect)) {
				onCancel(false);
				return;
			}
			const next = positionEnumPopover(anchorRect, state.options.length);
			setPosition((current) =>
				current.top === next.top &&
				current.left === next.left &&
				current.width === next.width &&
				current.maxHeight === next.maxHeight
					? current
					: next,
			);
			frame = requestAnimationFrame(updatePosition);
		};
		frame = requestAnimationFrame(updatePosition);
		return () => cancelAnimationFrame(frame);
	}, [onCancel, root, state]);

	useEffect(() => {
		const closeOutside = (event: PointerEvent) => {
			const target = event.target as Node;
			const anchor = findStateEnumAnchor(root, state);
			if (listRef.current?.contains(target) || anchor?.contains(target)) return;
			onCancel(false);
		};
		document.addEventListener("pointerdown", closeOutside, true);
		return () =>
			document.removeEventListener("pointerdown", closeOutside, true);
	}, [onCancel, root, state]);

	const move = (index: number) => {
		setActiveIndex(Math.max(0, Math.min(state.options.length - 1, index)));
	};
	const choose = (index: number) => {
		const option = state.options[index];
		if (option) onSubmit(option.value);
	};

	return (
		<div
			id={listboxId}
			ref={listRef}
			role="listbox"
			aria-label={state.label}
			className="fixed z-[var(--z-popover)] overflow-y-auto border border-border bg-panel shadow-[0_16px_48px_rgba(0,0,0,0.18)]"
			style={{
				...position,
			}}
			onKeyDown={(event) => {
				if (event.key === "ArrowDown") {
					event.preventDefault();
					move(activeIndex + 1);
				} else if (event.key === "ArrowUp") {
					event.preventDefault();
					move(activeIndex - 1);
				} else if (event.key === "Home") {
					event.preventDefault();
					move(0);
				} else if (event.key === "End") {
					event.preventDefault();
					move(state.options.length - 1);
				} else if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					choose(activeIndex);
				} else if (event.key === "Escape") {
					event.preventDefault();
					onCancel(true);
				} else if (event.key === "Tab") {
					onCancel(true);
				}
			}}
		>
			{state.options.map((option, index) => {
				const selected = option.value === state.selectedValue;
				return (
					<button
						key={option.value}
						ref={(element) => {
							optionRefs.current[index] = element;
						}}
						id={`maket-enum-option-${index}`}
						type="button"
						role="option"
						aria-selected={selected}
						onMouseEnter={() => setActiveIndex(index)}
						onClick={() => choose(index)}
						className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
							index === activeIndex
								? "bg-accent/10 text-text-1"
								: "text-text-2 hover:bg-input"
						}`}
					>
						<span className="min-w-0 flex-1 truncate">{option.label}</span>
						{selected && <Check size={14} className="shrink-0 text-accent" />}
					</button>
				);
			})}
		</div>
	);
}

export function positionEnumPopover(
	anchor: Pick<DOMRect, "top" | "bottom" | "left" | "width">,
	optionCount: number,
	viewport = { width: window.innerWidth, height: window.innerHeight },
): PopoverPosition {
	const gap = 4;
	const margin = 8;
	const width = Math.min(180, Math.max(0, viewport.width - margin * 2));
	const desiredHeight = Math.min(280, optionCount * 36 + 8);
	const availableBelow = Math.max(
		0,
		viewport.height - margin - anchor.bottom - gap,
	);
	const availableAbove = Math.max(0, anchor.top - margin - gap);
	const openBelow =
		desiredHeight <= availableBelow || availableBelow >= availableAbove;
	const maxHeight = Math.min(
		desiredHeight,
		openBelow ? availableBelow : availableAbove,
	);
	const top = openBelow
		? anchor.bottom + gap
		: Math.max(margin, anchor.top - gap - maxHeight);
	const left = Math.max(
		margin,
		Math.min(anchor.left, viewport.width - width - margin),
	);
	return { top, left, width, maxHeight };
}

export function enumAnchorIntersectsViewport(
	anchor: Pick<DOMRect, "top" | "bottom" | "left" | "right">,
	viewport = { width: window.innerWidth, height: window.innerHeight },
): boolean {
	return (
		anchor.bottom > 0 &&
		anchor.top < viewport.height &&
		anchor.right > 0 &&
		anchor.left < viewport.width
	);
}

export function findStateEnumAnchor(
	root: HTMLElement,
	state: Pick<StateEnumSelectState, "pointer" | "anchorIndex">,
): HTMLSelectElement | null {
	return (
		Array.from(
			root.querySelectorAll<HTMLSelectElement>(
				"select[data-maket-bind][data-maket-path]",
			),
		).filter((select) => select.dataset.maketPath === state.pointer)[
			state.anchorIndex
		] ?? null
	);
}
