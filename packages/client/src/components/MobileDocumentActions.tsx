import { Copy, Menu, MessageCircle, Pencil, Share2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/useT";
import { browserPath } from "../lib/browserBasePath";
import { useMobileHistoryState } from "../lib/mobileHistory";
import type { DocSummary } from "../store/types";
import { knownStructuredItems, useStore } from "../store/useStore";
import { sendRenameDoc } from "../store/ws";
import { randomId } from "../utils";
import { MobileDocumentRename } from "./MobileDocumentRename";
import { MobileMessageComposer } from "./MobileMessageComposer";
import { useMobilePdfShare } from "./MobilePdfShare";
import { useModalFocusTrap } from "./shared/useModalFocusTrap";

function documentUrl(
	doc: Pick<DocSummary, "id" | "name">,
	workspaceId?: string,
	collectionId?: string,
) {
	const state = useStore.getState();
	const loadedOwner = state.docs.get(doc.name)?.meta?.structuredWorkspace;
	const item = knownStructuredItems(state).find(
		(item) => item.documentName === doc.name,
	);
	const workspace = state.structuredWorkspaces.find((workspace) =>
		workspace.collectionDocuments.some(
			(entry) => entry.documentName === doc.name,
		),
	);
	const collection = workspace?.collectionDocuments.find(
		(entry) => entry.documentName === doc.name,
	);
	const owner =
		workspaceId ??
		loadedOwner?.workspaceId ??
		item?.workspaceId ??
		workspace?.id;
	const scope =
		collectionId ??
		loadedOwner?.collectionId ??
		item?.collectionId ??
		collection?.collectionId;
	const url = new URL(
		browserPath(`/documents/${encodeURIComponent(doc.id)}/read`),
		location.origin,
	);
	if (owner) url.searchParams.set("workspace", owner);
	if (scope) url.searchParams.set("collection", scope);
	return url.href;
}

/** Mobile document actions use the existing clipboard and annotation queue. */
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
function useDocumentActions({
	doc,
	workspaceId,
	collectionId,
	placement = "row",
}: {
	doc: Pick<DocSummary, "id" | "name"> & Partial<DocSummary>;
	placement?: "row" | "reader";
	workspaceId?: string;
	collectionId?: string;
}) {
	const t = useT();
	const connected = useStore((s) => s.connected);
	const [mode, setMode] = useMobileHistoryState<
		"closed" | "menu" | "note" | "rename"
	>(`document:${doc.id}:${placement}:mode`, "closed");
	const [text, setText] = useMobileHistoryState(
		`document:${doc.id}:text`,
		"",
		"context",
	);
	const [name, setName] = useMobileHistoryState(
		`document:${doc.id}:rename`,
		doc.name,
		"context",
	);
	const [sharing, setSharing] = useState(false);
	const loaded = useStore((state) => state.docs.get(doc.name));
	const summary = useStore((state) =>
		state.docList.find((entry) => entry.id === doc.id),
	);
	const owner =
		workspaceId ||
		loaded?.meta?.structuredWorkspace ||
		knownStructuredItems(useStore.getState()).find(
			(item) => item.documentName === doc.name,
		);
	const locked = summary?.locked || loaded?.meta?.locked;
	const renameBlocked = Boolean(
		locked || owner || (summary?.dataModel ?? doc.dataModel) === "state",
	);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const [saving, setSaving] = useState(false);
	const panel = useRef<HTMLDivElement>(null);
	const close = useRef<HTMLButtonElement>(null);
	const dismiss = () => {
		if (!saving) setMode("closed");
	};
	const pdf = useMobilePdfShare(
		doc.name,
		placement === "reader" || mode === "menu",
		() => {
			setSharing(false);
			setMode("closed");
		},
	);
	useEffect(() => {
		if (mode !== "menu") {
			pdf.cancel();
			setSharing(false);
		}
	}, [mode]);
	const share = async () => {
		setSharing(true);
		await pdf.share();
		setSharing(false);
		setMode("closed");
	};
	const rename = () => {
		const next = name.trim();
		if (!connected || renameBlocked || !next || next === doc.name) return;
		if (useStore.getState().docList.some((entry) => entry.name === next)) {
			setError(t("toast_document_name_taken", { name: next }));
			return;
		}
		sendRenameDoc(doc.name, next);
		setMode("closed");
	};
	useModalFocusTrap({
		open: mode === "menu" && !sharing,
		containerRef: panel,
		initialFocusRef: close,
		onEscape: dismiss,
	});
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(
				`${doc.name}\n${documentUrl(doc, workspaceId, collectionId)}`,
			);
			setNotice(t("mobile_document_link_copied"));
		} catch {
			setError(t("mobile_copy_failed"));
		}
	};
	const send = async () => {
		if (!text.trim() || saving) return;
		setSaving(true);
		setError("");
		const outcome = await useStore.getState().addPending({
			id: randomId(),
			type: "note",
			docName: doc.name,
			text: text.trim(),
			ts: Date.now(),
		});
		setSaving(false);
		if (!outcome.ok) {
			setError(outcome.error ?? t("pending_create_failed"));
			return;
		}
		setText("");
		setMode("closed");
	};
	return {
		t,
		connected,
		mode,
		setMode,
		text,
		setText,
		name,
		setName,
		sharing,
		renameBlocked,
		error,
		setError,
		notice,
		setNotice,
		saving,
		panel,
		close,
		dismiss,
		pdf,
		share,
		rename,
		copy,
		send,
	};
}

export function MobileDocumentActions({
	doc,
	workspaceId,
	collectionId,
	placement = "row",
}: {
	doc: Pick<DocSummary, "id" | "name"> & Partial<DocSummary>;
	placement?: "row" | "reader";
	workspaceId?: string;
	collectionId?: string;
}) {
	const {
		t,
		connected,
		mode,
		setMode,
		text,
		setText,
		name,
		setName,
		sharing,
		renameBlocked,
		error,
		setError,
		notice,
		setNotice,
		saving,
		panel,
		close,
		dismiss,
		pdf,
		share,
		rename,
		copy,
		send,
	} = useDocumentActions({ doc, workspaceId, collectionId, placement });
	return (
		<>
			<button
				type="button"
				aria-label={t("mobile_document_actions", { name: doc.name })}
				aria-haspopup="dialog"
				onClick={() => {
					setMode("menu");
					setError("");
					setNotice("");
				}}
				className={`${placement === "row" ? "absolute bottom-2 right-2" : "shrink-0 border border-border"} grid size-12 place-items-center rounded-xl text-text-2 hover:bg-input`}
			>
				<Menu size={22} />
			</button>
			{pdf.overlay}
			{mode === "rename" && (
				<MobileDocumentRename
					name={doc.name}
					value={name}
					onChange={setName}
					onCancel={dismiss}
					onSubmit={rename}
					error={error}
					disabled={!connected || Boolean(renameBlocked)}
				/>
			)}
			{mode === "note" && (
				<MobileMessageComposer
					documentName={doc.name}
					value={text}
					onChange={setText}
					onCancel={dismiss}
					onSubmit={() => void send()}
					saving={saving}
					disabled={!connected}
					error={error}
				/>
			)}
			{mode === "menu" &&
				!sharing &&
				createPortal(
					<div
						className="fixed inset-0 z-[2000] flex items-end bg-black/30"
						onClick={dismiss}
					>
						<div
							ref={panel}
							data-mobile-ui
							role="dialog"
							aria-modal="true"
							aria-label={t("mobile_document_actions", { name: doc.name })}
							onClick={(e) => e.stopPropagation()}
							className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-panel p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-text-1 shadow-xl"
						>
							<div className="flex items-start gap-2">
								<h2 className="min-w-0 flex-1 break-words py-3 text-base font-semibold">
									{doc.name}
								</h2>
								<button
									ref={close}
									type="button"
									disabled={saving}
									onClick={dismiss}
									aria-label={t("close")}
									className="grid size-12 shrink-0 place-items-center"
								>
									<X size={22} />
								</button>
							</div>
							<div className="flex flex-col gap-2">
								<button
									type="button"
									onClick={() => void copy()}
									className="flex min-h-14 items-center gap-3 rounded-xl bg-input px-4 py-3 text-left text-base"
								>
									<Copy size={22} />
									{t("mobile_copy_document_link")}
								</button>
								<button
									type="button"
									disabled={!connected}
									onClick={() => {
										setMode("note");
										setNotice("");
									}}
									className="flex min-h-14 items-center gap-3 rounded-xl bg-input px-4 py-3 text-left text-base disabled:opacity-40"
								>
									<MessageCircle size={22} />
									{t("mobile_document_write_message")}
								</button>
								<button
									type="button"
									disabled={!connected}
									onClick={() => void share()}
									className="flex min-h-14 items-center gap-3 rounded-xl bg-input px-4 py-3 text-left text-base disabled:opacity-40"
								>
									<Share2 size={22} />
									{t("mobile_document_share")}
								</button>
								{!renameBlocked && (
									<button
										type="button"
										disabled={!connected}
										onClick={() => {
											setName(doc.name);
											setError("");
											setMode("rename");
										}}
										className="flex min-h-14 items-center gap-3 rounded-xl bg-input px-4 py-3 text-left text-base disabled:opacity-40"
									>
										<Pencil size={22} />
										{t("doc_rename")}
									</button>
								)}
							</div>
							{notice && (
								<p role="status" className="mt-3 text-sm text-accent">
									{notice}
								</p>
							)}
							{error && (
								<p role="alert" className="mt-3 text-sm text-danger">
									{error}
								</p>
							)}
						</div>
					</div>,
					document.body,
				)}
		</>
	);
}
