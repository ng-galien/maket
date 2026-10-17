import { LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/useT";
import { browserPath } from "../lib/browserBasePath";
import { useStore } from "../store/useStore";
import { useModalFocusTrap } from "./shared/useModalFocusTrap";

function supportsPdfShare(file: File): boolean {
	try {
		return (
			typeof navigator.share === "function" &&
			navigator.canShare?.({ files: [file] }) === true
		);
	} catch {
		return false;
	}
}
function downloadPdf(file: File) {
	const url = URL.createObjectURL(file);
	const link = document.createElement("a");
	link.href = url;
	link.download = file.name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function preparePdf(
	docName: string,
	signal: AbortSignal,
	invalid: string,
) {
	const response = await fetch(
		browserPath(`/api/export-pdf?${new URLSearchParams({ name: docName })}`),
		{ signal, cache: "no-store" },
	);
	if (!response.ok) throw new Error(`PDF HTTP ${response.status}`);
	const bytes = await response.arrayBuffer();
	if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
		throw new Error(invalid);
	return new File([bytes], `${docName.replace(/[\\/:*?"<>|]/g, "-")}.pdf`, {
		type: "application/pdf",
	});
}

/** Keep only the current document's PDF warm. Sharing still belongs to a user
 * gesture: a slow cold export cannot extend the browser's transient activation. */
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
export function useMobilePdfShare(
	docName: string,
	prefetch: boolean,
	onCancel: () => void,
) {
	const t = useT();
	const revision = useStore((s) => s.documentStates[docName]?.revision);
	const updated = useStore(
		(s) => s.docList.find((d) => d.name === docName)?.updatedAt,
	);
	const doc = useStore((s) => s.docs.get(docName));
	const charteCss = useStore((s) => s.chartesCss.get(docName));
	const key = useMemo(
		() => ({}),
		[docName, revision, updated, doc?.pages, doc?.canvas, doc?.meta, charteCss],
	);
	const request = useRef<{
		key: object;
		file?: File;
		promise: Promise<File>;
		abort: AbortController;
	} | null>(null);
	const operation = useRef(0);
	const running = useRef(false);
	const [waiting, setWaiting] = useState(false);
	const [notice, setNotice] = useState("");
	const [failed, setFailed] = useState(false);
	const dialog = useRef<HTMLDivElement>(null);
	const cancel = useRef<HTMLButtonElement>(null);
	const dismiss = () => {
		operation.current++;
		running.current = false;
		setWaiting(false);
	};
	useModalFocusTrap({
		open: waiting,
		containerRef: dialog,
		initialFocusRef: cancel,
		onEscape: () => {
			dismiss();
			onCancel();
		},
	});
	const prepare = () => {
		if (request.current?.key === key) return request.current;
		request.current?.abort.abort();
		const abort = new AbortController();
		const next = {
			key,
			abort,
			promise: preparePdf(docName, abort.signal, t("mobile_pdf_invalid")),
			file: undefined as File | undefined,
		};
		request.current = next;
		void next.promise.then(
			(file) => {
				next.file = file;
			},
			() => {
				if (request.current === next) request.current = null;
			},
		);
		return next;
	};
	useEffect(() => {
		dismiss();
		if (prefetch) prepare();
		return () => {
			operation.current++;
			request.current?.abort.abort();
			request.current = null;
		};
	}, [key, prefetch]);
	useEffect(() => setNotice(""), [key]);
	useEffect(() => {
		if (!notice) return;
		const timer = setTimeout(() => setNotice(""), 8000);
		return () => clearTimeout(timer);
	}, [notice]);
	const share = async () => {
		if (running.current) return;
		running.current = true;
		const current = ++operation.current;
		setNotice("");
		setFailed(false);
		const pending = prepare();
		try {
			let file = pending.file;
			if (!file) {
				setWaiting(true);
				file = await pending.promise;
			}
			if (current !== operation.current || request.current !== pending) return;
			setWaiting(false);
			if (supportsPdfShare(file)) {
				await navigator.share({ files: [file], title: docName });
			} else {
				downloadPdf(file);
				setNotice(t("mobile_pdf_fallback"));
			}
		} catch (cause) {
			if (current !== operation.current) return;
			if (cause instanceof DOMException && cause.name === "AbortError") return;
			setFailed(true);
			setNotice(
				cause instanceof DOMException && cause.name === "NotAllowedError"
					? t("mobile_pdf_activation_expired")
					: `${t("mobile_pdf_failed")} ${cause instanceof Error ? cause.message : String(cause)}`,
			);
		} finally {
			if (current === operation.current) {
				running.current = false;
				setWaiting(false);
			}
		}
	};
	return {
		share,
		cancel: dismiss,
		overlay: (
			<>
				{waiting &&
					createPortal(
						<div
							ref={dialog}
							role="dialog"
							aria-modal="true"
							aria-label={t("mobile_pdf_preparing")}
							data-mobile-pdf-preparing
							className="fixed inset-0 z-[2200] flex flex-col items-center justify-center gap-6 bg-panel p-6 text-center text-text-1"
						>
							<LoaderCircle
								aria-hidden="true"
								size={48}
								className="animate-spin motion-reduce:animate-none text-accent"
							/>
							<p role="status" className="text-lg font-semibold">
								{t("mobile_pdf_preparing")}
							</p>
							<p className="max-w-full break-words text-base text-text-3">
								{docName}
							</p>
							<button
								ref={cancel}
								type="button"
								onClick={() => {
									dismiss();
									onCancel();
								}}
								className="min-h-12 rounded-xl border border-border px-8 py-3 text-base"
							>
								{t("cancel")}
							</button>
						</div>,
						document.body,
					)}
				{notice &&
					createPortal(
						<p
							role={failed ? "alert" : "status"}
							className="fixed inset-x-4 bottom-24 z-[2200] rounded-xl border border-border bg-panel p-4 text-base text-text-1 shadow-lg"
						>
							{notice}
						</p>,
						document.body,
					)}
			</>
		),
	};
}
