import {
	cloneElement,
	type HTMLAttributes,
	type ReactElement,
	type ReactNode,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";

/** Shared icon help for the library rail and document controls. */
export function Tooltip({
	children,
	label = children.props.title,
	side = "bottom",
	className = "",
}: {
	children: ReactElement<HTMLAttributes<HTMLElement>>;
	label?: ReactNode;
	side?: "bottom" | "right";
	className?: string;
}) {
	const anchorRef = useRef<HTMLSpanElement>(null);
	const tipRef = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [position, setPosition] = useState<{
		left: number;
		top: number;
	} | null>(null);
	const id = useId();
	useLayoutEffect(() => {
		if (!open || !label) return;
		const anchor = anchorRef.current?.getBoundingClientRect();
		const tip = tipRef.current?.getBoundingClientRect();
		if (!anchor || !tip) return;
		const left =
			side === "right"
				? anchor.right + 8
				: anchor.left + (anchor.width - tip.width) / 2;
		const top =
			side === "right"
				? anchor.top + (anchor.height - tip.height) / 2
				: anchor.bottom + 8;
		setPosition({
			left: Math.max(8, Math.min(left, window.innerWidth - tip.width - 8)),
			top: Math.max(
				8,
				Math.min(
					side === "bottom" && top + tip.height > window.innerHeight - 8
						? anchor.top - tip.height - 8
						: top,
					window.innerHeight - tip.height - 8,
				),
			),
		});
	}, [open, label, side]);
	useEffect(() => {
		if (!open) return;
		const close = () => setOpen(false);
		const key = (event: KeyboardEvent) => {
			if (event.key === "Escape") close();
		};
		window.addEventListener("keydown", key);
		window.addEventListener("resize", close);
		window.addEventListener("scroll", close, true);
		return () => {
			window.removeEventListener("keydown", key);
			window.removeEventListener("resize", close);
			window.removeEventListener("scroll", close, true);
		};
	}, [open]);
	const show = () => {
		if (open) return;
		setPosition(null);
		setOpen(true);
	};
	return (
		<span
			ref={anchorRef}
			className={`relative inline-flex shrink-0 justify-center ${className}`}
			onMouseEnter={show}
			onMouseLeave={() => setOpen(false)}
			onFocus={show}
			onBlur={() => setOpen(false)}
			onClick={() => setOpen(false)}
		>
			{cloneElement(children, {
				title: undefined,
				"aria-describedby":
					open && label ? id : children.props["aria-describedby"],
			})}
			{open &&
				label &&
				createPortal(
					<div
						ref={tipRef}
						id={id}
						role="tooltip"
						style={position ?? { left: 0, top: 0, visibility: "hidden" }}
						className="pointer-events-none fixed z-[var(--z-popover)] max-w-60 rounded-sm bg-text-1 px-2.5 py-1.5 text-sm font-medium leading-snug text-panel shadow-md"
					>
						{label}
					</div>,
					document.body,
				)}
		</span>
	);
}
