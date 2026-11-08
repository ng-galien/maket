import { normalizeCategoryPath } from "@maket/shared";
import { X } from "lucide-react";
import {
	type RefObject,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/useT";
import { browserPath } from "../lib/browserBasePath";
import { photoMatchesQuery } from "../lib/photoQuery";
import { useStore } from "../store/useStore";
import { parseQuery } from "./docs/docsQuery";
import { computeAnchoredMenuPosition } from "./shared/AnchoredMenu";
import { LibrarySearchField } from "./shared/LibrarySearchField";
import { Tooltip } from "./shared/Tooltip";

const BATCH_SIZE = 40;

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Library presentation adapter; the shared photo query and asset store own matching and loading.
export function ComposerImagePicker({
	anchorRef,
	onPick,
	onClose,
}: {
	anchorRef: RefObject<HTMLButtonElement | null>;
	onPick: (file: string) => void;
	onClose: () => void;
}) {
	const t = useT();
	const assets = useStore((s) => s.assets);
	const loading = useStore((s) => s.assetsLoading);
	const loadAssets = useStore((s) => s.loadAssets);
	const [search, setSearch] = useState("");
	const [category, setCategory] = useState("");
	const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
	const { ref, inputRef, position } = useImagePickerAnchor({
		anchorRef,
		onClose,
	});
	const categories = [
		...new Set(
			assets.flatMap((asset) => {
				const parts = normalizeCategoryPath(asset.category)
					.split("/")
					.filter(Boolean);
				return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
			}),
		),
	].sort((a, b) => a.localeCompare(b));
	const parsed = parseQuery(search);
	const filtered = assets.filter((asset) =>
		photoMatchesQuery(asset, {
			...parsed,
			categories: category ? [category.toLowerCase()] : parsed.categories,
		}),
	);

	useEffect(() => {
		void loadAssets();
	}, [loadAssets]);

	return createPortal(
		<div
			ref={ref}
			data-composer-image-picker
			role="dialog"
			aria-label={t("hand_pick_image")}
			onClick={(event) => event.stopPropagation()}
			className="fixed z-[var(--z-popover)] flex flex-col overflow-hidden rounded-xl border border-border bg-panel shadow-xl"
			style={position ?? { visibility: "hidden" }}
		>
			<div className="shrink-0 space-y-3 border-b border-border p-4">
				<div className="flex items-center justify-between">
					<h3 className="text-sm font-semibold text-text-1">
						{t("hand_pick_image")}
					</h3>
					<button
						type="button"
						aria-label={t("hand_close_picker")}
						onClick={onClose}
						className="rounded-md p-1 text-text-2 hover:bg-input"
					>
						<X size={16} />
					</button>
				</div>
				<div className="flex gap-2">
					<LibrarySearchField
						ref={inputRef}
						value={search}
						placeholder={t("hand_search_images")}
						onChange={(event) => {
							setSearch(event.target.value);
							setVisibleCount(BATCH_SIZE);
						}}
						onClear={() => {
							setSearch("");
							setVisibleCount(BATCH_SIZE);
							inputRef.current?.focus();
						}}
					/>
					<select
						aria-label={t("hand_image_category")}
						value={category}
						onChange={(event) => {
							setCategory(event.target.value);
							setVisibleCount(BATCH_SIZE);
						}}
						className="h-8 max-w-[40%] rounded-md border border-border bg-input px-2 text-xs text-text-2"
					>
						<option value="">{t("hand_all_categories")}</option>
						{categories.map((path) => (
							<option key={path} value={path}>
								{path}
							</option>
						))}
					</select>
				</div>
				<p role="status" className="text-xs text-text-2">
					{t("hand_image_results", {
						shown: Math.min(visibleCount, filtered.length),
						total: filtered.length,
					})}
				</p>
			</div>
			<div className="min-h-0 overflow-y-auto overscroll-contain p-3">
				<div
					role="listbox"
					aria-label={t("hand_pick_image")}
					className="grid grid-cols-3 gap-2 sm:grid-cols-4"
				>
					{filtered.slice(0, visibleCount).map((asset) => (
						<Tooltip key={asset.file} className="min-w-0 [&>button]:w-full">
							<button
								type="button"
								role="option"
								aria-selected={false}
								aria-label={asset.title || asset.file}
								title={[
									asset.title || asset.file,
									asset.category,
									asset.width && asset.height
										? `${asset.width} × ${asset.height}`
										: null,
								]
									.filter(Boolean)
									.join(" · ")}
								onClick={() => onPick(asset.file)}
								className="group min-w-0 rounded-lg p-1 text-left outline-none hover:bg-input focus-visible:ring-2 focus-visible:ring-accent"
							>
								<span className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md bg-input">
									<img
										loading="lazy"
										src={browserPath(
											`/assets/thumb/${encodeURIComponent(asset.file)}`,
										)}
										alt=""
										className="h-full w-full object-contain transition-transform duration-150 group-hover:scale-[1.03]"
									/>
								</span>
								<span className="mt-1.5 block truncate px-0.5 text-xs text-text-1">
									{asset.title || asset.file}
								</span>
							</button>
						</Tooltip>
					))}
				</div>
				{filtered.length === 0 && (
					<p className="py-10 text-center text-sm text-text-2">
						{t(
							loading
								? "hand_loading_images"
								: assets.length === 0
									? "hand_no_images"
									: "hand_no_image_results",
						)}
					</p>
				)}
				{visibleCount < filtered.length && (
					<button
						type="button"
						onClick={() => setVisibleCount((count) => count + BATCH_SIZE)}
						className="mt-3 w-full rounded-md bg-input px-3 py-2 text-xs font-semibold text-text-1 hover:bg-accent-soft"
					>
						{t("hand_more_images")}
					</button>
				)}
			</div>
		</div>,
		document.body,
	);
}

/** Anchor, dismissal and focus lifecycle of the searchable image picker. */
function useImagePickerAnchor({
	anchorRef,
	onClose,
}: {
	anchorRef: RefObject<HTMLButtonElement | null>;
	onClose: () => void;
}) {
	const [position, setPosition] = useState<{
		top: number;
		left: number;
		width: number;
		maxHeight: number;
	} | null>(null);
	const ref = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const closeRef = useRef(onClose);
	const restoreFocus = useRef(true);
	closeRef.current = onClose;
	useLayoutEffect(() => {
		const anchor = anchorRef.current;
		if (!anchor) return;
		const place = () => {
			const width = Math.min(560, window.innerWidth - 16);
			const anchorBox = anchor.getBoundingClientRect();
			const maxHeight = Math.min(
				600,
				Math.max(
					window.innerHeight - anchorBox.bottom - 12,
					anchorBox.top - 12,
				),
			);
			const point = computeAnchoredMenuPosition({
				anchor: anchorBox,
				menuWidth: width,
				menuHeight: maxHeight,
				viewportWidth: window.innerWidth,
				viewportHeight: window.innerHeight,
				align: "end",
			});
			setPosition({ top: point.top, left: point.left, width, maxHeight });
		};
		place();
		const outside = (event: PointerEvent) => {
			if (
				!(event.target instanceof Node) ||
				ref.current?.contains(event.target) ||
				anchor.contains(event.target)
			)
				return;
			restoreFocus.current = false;
			closeRef.current();
		};
		const key = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				closeRef.current();
			}
		};
		const scroll = (event: Event) => {
			if (
				!(event.target instanceof Node) ||
				!ref.current?.contains(event.target)
			)
				place();
		};
		window.addEventListener("pointerdown", outside);
		window.addEventListener("keydown", key, true);
		window.addEventListener("resize", place);
		window.addEventListener("scroll", scroll, true);
		return () => {
			window.removeEventListener("pointerdown", outside);
			window.removeEventListener("keydown", key, true);
			window.removeEventListener("resize", place);
			window.removeEventListener("scroll", scroll, true);
			if (restoreFocus.current && anchor.isConnected)
				anchor.focus({ preventScroll: true });
		};
	}, [anchorRef]);
	const ready = position !== null;
	useEffect(() => {
		if (ready) inputRef.current?.focus();
	}, [ready]);
	return { ref, inputRef, position };
}
