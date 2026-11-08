import {
	clampPlacedBox,
	type PlacedBox,
	type PlacedElementKind,
} from "@maket/shared";
import { type RefObject, useEffect, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import type { Document } from "../store/types";
import { useStore } from "../store/useStore";
import { sendAddPlacedElement } from "../store/ws";
import { defaultPlacedBox } from "./handEditing";

export type PlacementTool =
	| { kind: "text" | "frame" }
	| { kind: "image"; asset: string };
export interface CreatedPlacement {
	id: string;
	kind: PlacedElementKind;
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// Pointer adapter: shared geometry and the WS store own the validation and document mutation.
/** Local tool gesture; only the server confirmation identifies an inserted object. */
export function useHandPlacement({
	doc,
	pageIndex,
	enabled,
	pageRef,
	suppressClickRef,
}: {
	doc: Document;
	pageIndex: number;
	enabled: boolean;
	pageRef: RefObject<HTMLDivElement | null>;
	suppressClickRef: RefObject<boolean>;
}) {
	const t = useT();
	const [tool, setTool] = useState<PlacementTool | null>(null);
	const [preview, setPreview] = useState<PlacedBox | null>(null);
	const [created, setCreated] = useState<CreatedPlacement | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const live = useRef(enabled);
	live.current = enabled;
	useEffect(
		() => () => {
			live.current = false;
		},
		[],
	);
	useEffect(() => {
		if (!enabled) {
			setTool(null);
			setPreview(null);
			setCreated(null);
			setBusy(false);
		}
	}, [enabled]);

	useEffect(() => {
		const page = pageRef.current;
		if (!enabled || !tool || !page) return;
		let stopGesture: (() => void) | null = null;
		page.dataset.handPlacement = tool.kind;
		const dimensions = { w: doc.canvas.w, h: doc.canvas.h };
		const point = (event: PointerEvent) => {
			const rect = page.getBoundingClientRect();
			return {
				x: Math.max(
					0,
					Math.min(
						dimensions.w,
						((event.clientX - rect.left) * dimensions.w) / rect.width,
					),
				),
				y: Math.max(
					0,
					Math.min(
						dimensions.h,
						((event.clientY - rect.top) * dimensions.h) / rect.height,
					),
				),
			};
		};
		const anchored = (event: PointerEvent) => {
			const { x, y } = point(event);
			return clampPlacedBox(
				{ ...defaultPlacedBox(tool.kind, dimensions), left: x, top: y },
				dimensions.w,
				dimensions.h,
			);
		};
		const commit = async (box: PlacedBox) => {
			setTool(null);
			setPreview(null);
			setBusy(true);
			setError(null);
			const result = await sendAddPlacedElement(doc.name, pageIndex, {
				kind: tool.kind,
				box,
				...(tool.kind === "text" ? { text: t("hand_default_text") } : {}),
				...(tool.kind === "image" ? { asset: tool.asset } : {}),
			});
			const state = useStore.getState();
			if (
				!live.current ||
				state.focusedDocName !== doc.name ||
				state.focusedPageIndex !== pageIndex ||
				state.composerDocName !== doc.name
			)
				return;
			setBusy(false);
			if (result.ok) setCreated({ id: result.elementId, kind: tool.kind });
			else setError(result.error);
		};
		const hover = (event: PointerEvent) => {
			if (!stopGesture && tool.kind !== "frame") setPreview(anchored(event));
		};
		const leave = () => {
			if (!stopGesture) setPreview(null);
		};
		const down = (event: PointerEvent) => {
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			const start = point(event);
			let box = anchored(event);
			let traced = false;
			const move = (moveEvent: PointerEvent) => {
				if (tool.kind !== "frame") return;
				const end = point(moveEvent);
				traced =
					Math.abs(end.x - start.x) >= 2 && Math.abs(end.y - start.y) >= 2;
				box = {
					left: Math.min(start.x, end.x),
					top: Math.min(start.y, end.y),
					width: Math.max(2, Math.abs(end.x - start.x)),
					height: Math.max(2, Math.abs(end.y - start.y)),
				};
				setPreview(clampPlacedBox(box, dimensions.w, dimensions.h));
			};
			const clear = () => {
				window.removeEventListener("pointermove", move);
				window.removeEventListener("pointerup", up);
				window.removeEventListener("pointercancel", cancel);
				stopGesture = null;
			};
			const cancel = () => {
				clear();
				setPreview(null);
			};
			const up = () => {
				clear();
				suppressClickRef.current = true;
				if (tool.kind === "frame" && !traced) {
					setPreview(null);
					return;
				}
				void commit(clampPlacedBox(box, dimensions.w, dimensions.h));
			};
			stopGesture = cancel;
			window.addEventListener("pointermove", move);
			window.addEventListener("pointerup", up);
			window.addEventListener("pointercancel", cancel);
		};
		const key = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				setTool(null);
				setPreview(null);
			}
		};
		page.addEventListener("pointerdown", down, true);
		page.addEventListener("pointermove", hover);
		page.addEventListener("pointerleave", leave);
		window.addEventListener("keydown", key, true);
		return () => {
			stopGesture?.();
			delete page.dataset.handPlacement;
			page.removeEventListener("pointerdown", down, true);
			page.removeEventListener("pointermove", hover);
			page.removeEventListener("pointerleave", leave);
			window.removeEventListener("keydown", key, true);
		};
	}, [
		doc.name,
		doc.canvas.w,
		doc.canvas.h,
		enabled,
		pageIndex,
		pageRef,
		suppressClickRef,
		t,
		tool,
	]);
	return {
		tool,
		setTool,
		preview,
		created,
		clearCreated: () => setCreated(null),
		busy,
		error,
	};
}
