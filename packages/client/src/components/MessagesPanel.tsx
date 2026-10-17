import {
	Eye,
	Images,
	LoaderCircle,
	MessageCircle,
	Pencil,
	Trash2,
	Type,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getLang, useT } from "../i18n/useT";
import { useMobileHistoryState } from "../lib/mobileHistory";
import type { PendingMessage } from "../store/useStore";
import { useStore } from "../store/useStore";
import { sendLoadDoc } from "../store/ws";
import { requestFit } from "../store/zoomBridge";
import { GeneralMessageComposer } from "./GeneralMessageComposer";
import { MobileMessageComposer } from "./MobileMessageComposer";
import { HoldToDelete } from "./shared/HoldToDelete";
import { LibrarySearchField } from "./shared/LibrarySearchField";
import {
	LibraryToolbar,
	LibraryToolbarActions,
	LibraryToolbarRow,
} from "./shared/LibraryToolbar";
import { showLibraryScrollActivity } from "./shared/libraryScroll";

function messageElement(msg: PendingMessage): HTMLElement | null {
	if (!msg.elementId || !msg.docName || typeof msg.pageIndex !== "number")
		return null;
	return (
		[...document.querySelectorAll<HTMLElement>("[data-id]")].find((element) => {
			const doc = element.closest<HTMLElement>("[data-doc]");
			const page = element.closest<HTMLElement>(".page-canvas");
			return (
				element.dataset.id === msg.elementId &&
				doc?.dataset.doc === msg.docName &&
				Number(page?.dataset.page) === msg.pageIndex
			);
		}) ?? null
	);
}

function messageTarget(msg: PendingMessage): HTMLElement | null {
	const element = messageElement(msg);
	if (element) return element;
	if (!msg.docName) return null;
	const doc = [...document.querySelectorAll<HTMLElement>("[data-doc]")].find(
		(candidate) => candidate.dataset.doc === msg.docName,
	);
	if (!doc) return null;
	if (typeof msg.pageIndex !== "number") return doc;
	return (
		[...doc.querySelectorAll<HTMLElement>(".page-canvas")].find(
			(page) => Number(page.dataset.page) === msg.pageIndex,
		) ?? doc
	);
}

function highlightElement(msg: PendingMessage, on: boolean) {
	const el = messageTarget(msg);
	if (!el) return;
	el.toggleAttribute("data-maket-message-target", on);
}

function revealMessageTarget(msg: PendingMessage) {
	if (!msg.docName) return;
	const pageIndex = msg.pageIndex ?? 0;
	const state = useStore.getState();
	if (state.mobileReading) {
		state.openWorkspaceDocument(msg.docName);
		state.closeLastPanel();
	} else {
		state.addDocToWorkspace(msg.docName);
		state.setWorkspaceView("canvas");
	}
	state.setFocusedPage(msg.docName, pageIndex);
	requestFit({ docName: msg.docName, pageIndex });
	requestAnimationFrame(() =>
		requestAnimationFrame(() => {
			highlightElement(msg, true);
			setTimeout(() => highlightElement(msg, false), 5000);
		}),
	);
}

function showMessageLibrary(msg: PendingMessage) {
	useStore
		.getState()
		.setLibraryView(msg.type === "classify-images" ? "photos" : "docs");
}

function openMessageTarget(
	msg: PendingMessage,
	onOpened: () => void,
	onError: () => void,
) {
	if (!msg.docName) {
		showMessageLibrary(msg);
		onOpened();
		return;
	}
	if (useStore.getState().docs.has(msg.docName)) {
		revealMessageTarget(msg);
		onOpened();
		return;
	}
	let settled = false;
	let timeout = 0;
	const unsubscribe = useStore.subscribe((state) => {
		if (!msg.docName || !state.docs.has(msg.docName)) return;
		settled = true;
		window.clearTimeout(timeout);
		unsubscribe();
		revealMessageTarget(msg);
		onOpened();
	});
	if (!sendLoadDoc(msg.docName)) {
		unsubscribe();
		onError();
		return;
	}
	timeout = window.setTimeout(() => {
		unsubscribe();
		if (!settled) onError();
	}, 5000);
}

function formatTime(ts: number): string {
	const d = new Date(ts);
	return d.toLocaleTimeString(getLang() === "fr" ? "fr-FR" : "en-GB", {
		hour: "2-digit",
		minute: "2-digit",
	});
}

function resolveElementLabel(msg: PendingMessage): string {
	return messageElement(msg)?.getAttribute("data-name") || msg.elementId || "";
}

function TypeBadge({ type }: { type: PendingMessage["type"] }) {
	const base =
		"flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center";
	switch (type) {
		case "note":
			return null;
		case "delete":
			return (
				<span className={`${base} bg-danger-soft text-danger`}>
					<Trash2 size={15} />
				</span>
			);
		case "drop-image":
			return (
				<span className={`${base} bg-accent-soft text-accent`}>
					<Images size={15} />
				</span>
			);
		case "drop-text":
			return (
				<span className={`${base} bg-accent-soft text-accent`}>
					<Type size={15} />
				</span>
			);
		case "classify-images":
			return (
				<span className={`${base} bg-accent-soft text-accent`}>
					<Images size={15} />
				</span>
			);
		default:
			return <span className={`${base} bg-input text-text-3`} />;
	}
}

function MessageScope({ msg }: { msg: PendingMessage }) {
	const t = useT();
	const hasDoc = Boolean(msg.docName);
	const hasPage = typeof msg.pageIndex === "number";
	const hasEl = Boolean(msg.elementId);
	const elLabel = msg.elementId ? resolveElementLabel(msg) : "";

	if (!hasDoc && !hasPage && !hasEl)
		return (
			<span className="truncate text-[13px] font-semibold text-text-1">
				{t(msg.type === "note" ? "pending_general_scope" : "scope_workspace")}
			</span>
		);

	return (
		<span className="flex min-w-0 flex-1 flex-col gap-0.5">
			{hasDoc && (
				<span className="truncate text-[13px] font-semibold text-text-1">
					{msg.docName}
				</span>
			)}
			{(hasPage || hasEl) && (
				<span className="flex min-w-0 items-center gap-1.5 text-xs text-text-2">
					{hasPage && (
						<span className="shrink-0 tabular-nums">
							{t("page")} {(msg.pageIndex ?? 0) + 1}
						</span>
					)}
					{hasPage && hasEl && <span aria-hidden="true">·</span>}
					{hasEl && (
						<span className="truncate" title={msg.elementId}>
							{elLabel}
						</span>
					)}
				</span>
			)}
		</span>
	);
}

function MessageBody({ msg }: { msg: PendingMessage }) {
	const t = useT();
	if (msg.type === "note")
		return (
			<p className="text-text-1 whitespace-pre-wrap break-words">{msg.text}</p>
		);
	if (msg.type === "delete")
		return <p className="font-semibold text-danger">{t("pending_delete")}</p>;
	if (msg.type === "drop-image")
		return (
			<p className="text-text-1 break-words">
				{t("pending_insert_image", { file: msg.file ?? "" })}
			</p>
		);
	if (msg.type === "drop-text")
		return <p className="text-text-1">{t("pending_insert_text")}</p>;
	if (msg.type === "classify-images")
		return <p className="text-text-1 break-words">{msg.text}</p>;
	return null;
}

function MessageEditor({
	documentName,
	context,
	error,
	initial,
	saving,
	onSave,
	onCancel,
}: {
	documentName: string;
	context?: string;
	error?: string | null;
	initial: string;
	saving: boolean;
	onSave: (text: string) => void;
	onCancel: () => void;
}) {
	const t = useT();
	const [value, setValue] = useMobileHistoryState(
		`message-edit:${documentName}:${initial}`,
		initial,
		"context",
	);
	const mobile = useStore((state) => state.mobileReading);
	const fieldRef = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		const field = fieldRef.current;
		if (!field) return;
		field.focus();
		field.setSelectionRange(field.value.length, field.value.length);
	}, []);
	useLayoutEffect(() => {
		const field = fieldRef.current;
		if (!field) return;
		field.style.height = "auto";
		if (value) field.style.height = `${Math.min(field.scrollHeight, 200)}px`;
	}, [value]);
	const commit = () => {
		if (!value.trim() || saving) return;
		onSave(value);
	};
	if (mobile)
		return (
			<MobileMessageComposer
				documentName={documentName}
				context={context}
				value={value}
				onChange={setValue}
				onCancel={onCancel}
				onSubmit={commit}
				saving={saving}
				error={error}
				submitLabel={t("pending_edit_save")}
			/>
		);
	return (
		<div className="flex flex-col gap-1.5">
			<textarea
				ref={fieldRef}
				value={value}
				aria-label={t("pending_edit")}
				readOnly={saving}
				onChange={(event) => setValue(event.target.value)}
				onKeyDown={(event) => {
					if (
						event.key === "Enter" &&
						!event.shiftKey &&
						!event.nativeEvent.isComposing
					) {
						event.preventDefault();
						commit();
					} else if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						onCancel();
					}
				}}
				rows={2}
				className="w-full resize-none rounded-md bg-accent/5 px-2.5 py-2 text-[14px] leading-[20px] text-text-1 outline-none ring-2 ring-accent/30"
			/>
			<div className="flex items-center justify-end gap-1.5">
				<button
					type="button"
					onClick={onCancel}
					className="h-7 rounded-md px-2.5 text-xs font-medium text-text-2 hover:bg-input hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
				>
					{t("cancel")}
				</button>
				<button
					type="button"
					onClick={commit}
					disabled={saving || !value.trim()}
					aria-busy={saving}
					className="flex h-7 items-center gap-1 rounded-md bg-accent px-2.5 text-xs font-semibold text-accent-contrast hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-35"
				>
					{saving && (
						<LoaderCircle
							size={12}
							className="animate-spin"
							aria-hidden="true"
						/>
					)}
					{t("pending_edit_save")}
				</button>
			</div>
		</div>
	);
}

const iconButton =
	"inline-flex h-7 w-7 items-center justify-center rounded-sm text-text-3 transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50";

function MessageCard({
	msg,
	onDelete,
	onEdit,
}: {
	msg: PendingMessage;
	onDelete: (id: string) => boolean;
	onEdit: (
		id: string,
		text: string,
	) => Promise<{ ok: boolean; error?: string }>;
}) {
	const t = useT();
	const [busy, setBusy] = useState<"opening" | "deleting" | "saving" | null>(
		null,
	);
	const [mode, setMode] = useMobileHistoryState<"view" | "edit" | "delete">(
		`message:${msg.id}:mode`,
		"view",
	);
	const [error, setError] = useState<string | null>(null);
	const editable = msg.type === "note";
	const hasTarget = Boolean(msg.docName) || msg.type !== "note";
	useEffect(
		() => () => {
			highlightElement(msg, false);
		},
		[msg],
	);
	useEffect(() => {
		if (busy !== "deleting") return;
		const timeout = window.setTimeout(() => {
			setBusy(null);
			setError(t("pending_delete_failed"));
		}, 5000);
		return () => window.clearTimeout(timeout);
	}, [busy, t]);
	const openTarget = () => {
		setError(null);
		setBusy("opening");
		openMessageTarget(
			msg,
			() => setBusy(null),
			() => {
				setBusy(null);
				setError(t("pending_open_failed"));
			},
		);
	};
	const deleteMessage = () => {
		setMode("view");
		setError(null);
		setBusy("deleting");
		if (onDelete(msg.id)) return;
		setBusy(null);
		setError(t("pending_delete_failed"));
	};
	const saveEdit = async (text: string) => {
		setError(null);
		setBusy("saving");
		const outcome = await onEdit(msg.id, text);
		setBusy(null);
		if (!outcome.ok) {
			setError(outcome.error ?? t("pending_edit_failed"));
			return;
		}
		setMode("view");
	};
	return (
		<article
			aria-busy={busy !== null}
			data-message-id={msg.id}
			className={`rounded-md border px-3 py-2.5 transition-colors ${
				msg.type === "delete"
					? "border-danger-border bg-danger-soft"
					: "border-border bg-panel hover:bg-input/50"
			}`}
			onMouseEnter={() => highlightElement(msg, true)}
			onMouseLeave={() => highlightElement(msg, false)}
		>
			<div data-message-heading className="flex min-w-0 items-start gap-2">
				<MessageHeading
					msg={msg}
					hasTarget={hasTarget}
					busy={busy !== null}
					onOpen={openTarget}
				/>
				<div className="ml-auto flex shrink-0 items-center gap-0.5">
					<MessageTimestamp msg={msg} />
					{hasTarget && (
						<button
							type="button"
							onClick={openTarget}
							disabled={busy !== null}
							aria-label={
								busy === "opening"
									? t("pending_opening")
									: t("pending_open_target")
							}
							title={t("pending_open_target")}
							className={`${iconButton} hover:bg-panel hover:text-text-1 focus-visible:ring-accent`}
						>
							{busy === "opening" ? (
								<LoaderCircle
									size={14}
									className="animate-spin"
									aria-hidden="true"
								/>
							) : (
								<Eye size={14} aria-hidden="true" />
							)}
						</button>
					)}
					{editable && (
						<button
							type="button"
							aria-label={t("pending_edit")}
							title={t("pending_edit")}
							aria-pressed={mode === "edit"}
							onClick={() => {
								setError(null);
								setMode(mode === "edit" ? "view" : "edit");
							}}
							disabled={busy !== null}
							className={`${iconButton} hover:bg-accent-soft hover:text-accent focus-visible:ring-accent`}
						>
							<Pencil size={13} aria-hidden="true" />
						</button>
					)}
					<button
						type="button"
						aria-label={
							busy === "deleting"
								? t("pending_deleting")
								: t("pending_delete_note")
						}
						title={t("pending_delete_note")}
						onClick={() => {
							setError(null);
							setMode(mode === "delete" ? "view" : "delete");
						}}
						disabled={busy !== null}
						className={`${iconButton} hover:bg-danger-soft hover:text-danger focus-visible:ring-danger`}
					>
						{busy === "deleting" ? (
							<LoaderCircle
								size={14}
								className="animate-spin"
								aria-hidden="true"
							/>
						) : (
							<Trash2 size={14} aria-hidden="true" />
						)}
					</button>
				</div>
			</div>
			<div className="mt-2 flex items-start gap-2">
				<TypeBadge type={msg.type} />
				<div className="min-w-0 flex-1 text-[15px] leading-[21px]">
					{mode === "edit" && editable ? (
						<MessageEditor
							documentName={msg.docName ?? t("pending_general_scope")}
							context={
								typeof msg.pageIndex === "number"
									? `${t("page")} ${msg.pageIndex + 1}${msg.elementId ? ` · ${msg.elementId}` : ""}`
									: undefined
							}
							error={error}
							initial={msg.text ?? ""}
							saving={busy === "saving"}
							onSave={saveEdit}
							onCancel={() => setMode("view")}
						/>
					) : (
						<MessageBody msg={msg} />
					)}
				</div>
			</div>
			{mode === "delete" && (
				<div className="mt-2">
					<HoldToDelete
						label={t("pending_hold_delete")}
						onConfirm={deleteMessage}
						onCancel={() => setMode("view")}
					/>
				</div>
			)}
			{error && (
				<p className="mt-2 text-xs font-medium text-danger" role="alert">
					{error}
				</p>
			)}
		</article>
	);
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// MessagesPanel is an adapter over the pending queue: queue ownership stays in Zustand while the panel only renders and dispatches UI commands.
export function MessagesPanel() {
	const t = useT();
	const [composing, setComposing] = useMobileHistoryState(
		"messages:compose",
		false,
	);
	const [search, setSearch] = useMobileHistoryState(
		"messages:search",
		"",
		"context",
	);
	const pending = useStore((s) => s.pending);
	const editPending = useStore((s) => s.editPending);
	const removePending = useStore((s) => s.removePending);
	useEffect(() => {
		if (pending.length > 0) return;
		for (const target of document.querySelectorAll<HTMLElement>(
			"[data-maket-message-target]",
		)) {
			target.removeAttribute("data-maket-message-target");
		}
	}, [pending.length]);
	const filteredPending = useMemo(() => {
		const query = search.trim().toLocaleLowerCase();
		if (!query) return pending;
		return pending.filter((message) =>
			[
				message.text,
				message.type,
				message.docName,
				message.elementId,
				message.file,
				message.position,
			]
				.filter(Boolean)
				.join(" ")
				.toLocaleLowerCase()
				.includes(query),
		);
	}, [pending, search]);

	return (
		<section
			id="panel-exchange"
			aria-labelledby="messages-panel-title"
			className="flex h-full min-h-0 flex-col overflow-hidden bg-panel"
		>
			<LibraryToolbar>
				<h2 id="messages-panel-title" className="sr-only">
					{t("exchanges")}
				</h2>
				<LibraryToolbarRow>
					<LibrarySearchField
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						onClear={() => setSearch("")}
						placeholder={t("pending_search_hint")}
					/>
					<LibraryToolbarActions>
						<p className="shrink-0 text-xs text-text-3" aria-live="polite">
							{t("pending_count", { count: pending.length })}
						</p>
					</LibraryToolbarActions>
				</LibraryToolbarRow>
				<button
					type="button"
					onClick={() => setComposing(true)}
					className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-contrast"
				>
					<MessageCircle size={20} aria-hidden="true" />
					{t("mobile_document_write_message")}
				</button>
			</LibraryToolbar>
			<GeneralMessageComposer
				open={composing}
				onClose={() => setComposing(false)}
				onCreated={() => {
					setSearch("");
					setComposing(false);
				}}
			/>
			<div
				data-messages-scroll
				onScroll={showLibraryScrollActivity}
				className="library-scroll-area flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-3"
			>
				{pending.length === 0 ? (
					<div className="flex-1 flex flex-col items-center justify-center gap-2 text-text-3 text-sm text-center px-4">
						<span className="w-10 h-10 rounded-full bg-input flex items-center justify-center">
							<MessageCircle size={18} />
						</span>
						<span className="whitespace-pre-line leading-relaxed">
							{t("pending_empty")}
						</span>
					</div>
				) : filteredPending.length === 0 ? (
					<div className="px-4 py-6 text-center text-sm text-text-3">
						{t("pending_no_match")}
					</div>
				) : (
					filteredPending.map((msg) => (
						<MessageCard
							key={msg.id}
							msg={msg}
							onDelete={removePending}
							onEdit={editPending}
						/>
					))
				)}
			</div>
		</section>
	);
}

function MessageTimestamp({ msg }: { msg: PendingMessage }) {
	const t = useT();
	return (
		<span className="mr-1 flex flex-col items-end text-xs font-medium tabular-nums text-text-3">
			<time>{formatTime(msg.ts)}</time>
			{msg.edited && msg.editedAt && (
				<span data-message-edited="" className="text-2xs font-normal">
					{t("pending_edited", { time: formatTime(msg.editedAt) })}
				</span>
			)}
		</span>
	);
}

function MessageHeading({
	msg,
	hasTarget,
	busy,
	onOpen,
}: {
	msg: PendingMessage;
	hasTarget: boolean;
	busy: boolean;
	onOpen: () => void;
}) {
	const t = useT();
	return (
		<>
			{hasTarget ? (
				<button
					type="button"
					onClick={onOpen}
					disabled={busy}
					title={t("pending_open_target")}
					className="flex min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
				>
					<MessageScope msg={msg} />
				</button>
			) : (
				<div className="min-w-0 flex-1">
					<MessageScope msg={msg} />
				</div>
			)}
		</>
	);
}
