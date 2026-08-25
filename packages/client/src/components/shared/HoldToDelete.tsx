import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n/useT";

interface Props {
	label: string;
	onConfirm: () => void;
	onCancel: () => void;
}

/**
 * Destructive confirmation that forces a ~650ms press-and-hold before firing.
 * Used in place of window.confirm throughout the app — see
 * Follows the "No window.prompt / window.confirm" interaction invariant.
 */
export function HoldToDelete({ label, onConfirm, onCancel }: Props) {
	const t = useT();
	const HOLD_MS = 650;
	const [progress, setProgress] = useState(0);
	const rafRef = useRef<number | null>(null);
	const startRef = useRef<number | null>(null);
	const firedRef = useRef(false);

	const stop = () => {
		if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
		rafRef.current = null;
		startRef.current = null;
	};

	const tick = (now: number) => {
		if (startRef.current == null) startRef.current = now;
		const p = Math.min(1, (now - startRef.current) / HOLD_MS);
		setProgress(p);
		if (p >= 1) {
			if (!firedRef.current) {
				firedRef.current = true;
				stop();
				onConfirm();
			}
			return;
		}
		rafRef.current = requestAnimationFrame(tick);
	};

	const begin = (e: React.PointerEvent) => {
		if (firedRef.current) return;
		e.preventDefault();
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
		rafRef.current = requestAnimationFrame(tick);
	};

	const end = () => {
		if (firedRef.current) return;
		stop();
		setProgress(0);
	};

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onCancel();
		};
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("keydown", onKey);
			stop();
		};
	}, [onCancel]);

	return (
		<div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-danger-soft text-danger">
			<button
				type="button"
				onPointerDown={begin}
				onPointerUp={end}
				onPointerLeave={end}
				onPointerCancel={end}
				className="relative flex-1 min-w-0 flex items-center gap-2.5 py-1 select-none text-left focus:outline-none"
			>
				<div
					className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 bg-danger/15"
					style={{ transform: `scale(${1 + progress * 0.08})` }}
				>
					<Trash2 size={13} />
				</div>
				<span className="relative flex-1 truncate text-sm font-semibold">
					{label}
				</span>
				<div
					className="absolute inset-x-0 bottom-0 h-0.5 bg-danger rounded-full origin-left"
					style={{ transform: `scaleX(${progress})` }}
				/>
			</button>
			<button
				type="button"
				onClick={onCancel}
				aria-label={t("cancel")}
				className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-danger/15 text-danger"
			>
				<span aria-hidden className="text-base leading-none">
					×
				</span>
			</button>
		</div>
	);
}
