import {
	FORMATS,
	type PlacedElementKind,
	placedCompositionFormat,
	SCREEN_FORMATS,
} from "@maket/shared";
import { FilePlus, Image, Square, Type } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/useT";
import { browserPath } from "../lib/browserBasePath";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
import {
	sendAddPage,
	sendAddPlacedElement,
	sendCanvasFormat,
} from "../store/ws";
import { defaultPlacedBox } from "./handEditing";

const FIXED_FORMATS = Object.keys(FORMATS).filter(placedCompositionFormat);

type Orientation = "portrait" | "landscape";

const BUTTON =
	"flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-text-2 transition hover:bg-input hover:text-text-1 disabled:opacity-40";

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// UI adapter: the bar turns clicks into WS commands owned by the store module.
/** Page composition bar for the focused page of a writable document:
 * format and orientation, page addition, and the element palette on a
 * fixed format. Fixed to the bottom of the viewport so it keeps its size at
 * every board zoom. */
export function HandComposeBar({
	doc,
	pageIndex,
}: {
	doc: Document;
	pageIndex: number;
}) {
	const t = useT();
	const [picking, setPicking] = useState(false);
	const format = doc.canvas.format ?? "A4";
	const orientation: Orientation =
		doc.canvas.orientation === "landscape" ? "landscape" : "portrait";
	const fixed = placedCompositionFormat(format);
	const page = { w: doc.canvas.w, h: doc.canvas.h };

	const add = (kind: PlacedElementKind, extra: { asset?: string } = {}) => {
		sendAddPlacedElement(doc.name, pageIndex, {
			kind,
			box: defaultPlacedBox(kind, page),
			...(kind === "text" ? { text: t("hand_default_text") } : {}),
			...extra,
		});
	};

	return createPortal(
		<div
			data-hand-compose-bar=""
			role="toolbar"
			aria-label={t("hand_compose_bar")}
			onClick={(event) => event.stopPropagation()}
			onKeyDown={(event) => event.stopPropagation()}
			className="fixed bottom-5 left-1/2 z-[var(--z-popover)] flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-panel px-2 py-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.18)]"
		>
			<label className="flex items-center gap-1.5 px-1 text-xs text-text-3">
				<span className="sr-only">{t("hand_format")}</span>
				<select
					aria-label={t("hand_format")}
					value={format}
					onChange={(event) =>
						sendCanvasFormat(doc.name, event.target.value, orientation)
					}
					className="h-8 rounded-lg border border-border bg-input px-2 text-xs font-semibold text-text-1 outline-none focus:border-accent"
				>
					{!fixed && (
						<option value={format} disabled>
							{t("hand_auto_format")}
						</option>
					)}
					{FIXED_FORMATS.map((name) => (
						<option key={name} value={name}>
							{name}
						</option>
					))}
				</select>
			</label>
			<select
				aria-label={t("hand_orientation")}
				value={orientation}
				disabled={!fixed || SCREEN_FORMATS.has(format)}
				onChange={(event) =>
					sendCanvasFormat(doc.name, format, event.target.value as Orientation)
				}
				className="h-8 rounded-lg border border-border bg-input px-2 text-xs font-semibold text-text-1 outline-none focus:border-accent disabled:opacity-40"
			>
				<option value="portrait">{t("hand_portrait")}</option>
				<option value="landscape">{t("hand_landscape")}</option>
			</select>
			<span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
			<button
				type="button"
				className={BUTTON}
				onClick={() => sendAddPage(doc.name)}
			>
				<FilePlus size={14} aria-hidden="true" />
				{t("hand_add_page")}
			</button>
			<span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
			{fixed ? (
				<>
					<button type="button" className={BUTTON} onClick={() => add("text")}>
						<Type size={14} aria-hidden="true" />
						{t("hand_add_text")}
					</button>
					<button
						type="button"
						className={BUTTON}
						aria-expanded={picking}
						onClick={() => setPicking((open) => !open)}
					>
						<Image size={14} aria-hidden="true" />
						{t("hand_add_image")}
					</button>
					<button type="button" className={BUTTON} onClick={() => add("frame")}>
						<Square size={14} aria-hidden="true" />
						{t("hand_add_frame")}
					</button>
					{picking && (
						<ImagePicker
							onPick={(file) => {
								setPicking(false);
								add("image", { asset: file });
							}}
							onClose={() => setPicking(false)}
						/>
					)}
				</>
			) : (
				<span className="px-2 text-xs text-text-3">{t("hand_auto_hint")}</span>
			)}
		</div>,
		document.body,
	);
}

function ImagePicker({
	onPick,
	onClose,
}: {
	onPick: (file: string) => void;
	onClose: () => void;
}) {
	const t = useT();
	const assets = useStore((s) => s.assets);
	const loadAssets = useStore((s) => s.loadAssets);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		void loadAssets();
	}, [loadAssets]);
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);
	return (
		<div
			ref={ref}
			role="listbox"
			aria-label={t("hand_pick_image")}
			className="absolute bottom-full left-1/2 mb-2 grid max-h-72 w-80 -translate-x-1/2 grid-cols-3 gap-1.5 overflow-auto rounded-xl border border-border bg-panel p-2 shadow-[0_12px_32px_rgba(15,23,42,0.18)]"
		>
			{assets.length === 0 && (
				<p className="col-span-3 p-2 text-xs text-text-3">
					{t("hand_no_images")}
				</p>
			)}
			{assets.map((asset) => (
				<button
					key={asset.file}
					type="button"
					role="option"
					aria-selected={false}
					aria-label={asset.title || asset.file}
					title={asset.title || asset.file}
					onClick={() => onPick(asset.file)}
					className="aspect-square overflow-hidden rounded-md border border-border bg-input hover:border-accent"
				>
					<img
						src={browserPath(`/assets/thumb/${asset.file}`)}
						alt=""
						className="h-full w-full object-cover"
					/>
				</button>
			))}
		</div>
	);
}
