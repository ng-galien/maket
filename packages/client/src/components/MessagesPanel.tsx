import {
	Eye,
	FileText,
	Images,
	LoaderCircle,
	MessageSquareText,
	Send,
	Trash2,
	Type,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getLang, useT } from "../i18n/useT";
import type { PendingMessage } from "../store/useStore";
import { useStore } from "../store/useStore";
import { sendLoadDoc } from "../store/ws";
import { requestFit } from "../store/zoomBridge";
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
	state.addDocToWorkspace(msg.docName);
	state.setWorkspaceView("canvas");
	state.setFocusedPage(msg.docName, pageIndex);
	requestFit({ docName: msg.docName, pageIndex });
	requestAnimationFrame(() =>
		requestAnimationFrame(() => {
			highlightElement(msg, true);
			setTimeout(() => highlightElement(msg, false), 5000);
		}),
	);
}

function openMessageTarget(
	msg: PendingMessage,
	onOpened: () => void,
	onError: () => void,
) {
	if (!msg.docName) {
		onError();
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
				{t("scope_workspace")}
			</span>
		);

	return (
		<div className="flex min-w-0 flex-1 flex-col gap-0.5">
			{hasDoc && (
				<span className="truncate text-[13px] font-semibold text-text-1">
					{msg.docName}
				</span>
			)}
			{(hasPage || hasEl) && (
				<div className="flex min-w-0 items-center gap-1.5 text-xs text-text-2">
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
				</div>
			)}
		</div>
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

function MessageCard({
	msg,
	onDelete,
}: {
	msg: PendingMessage;
	onDelete: (id: string) => boolean;
}) {
	const t = useT();
	const canOpen = Boolean(msg.docName);
	const [busy, setBusy] = useState<"opening" | "deleting" | null>(null);
	const [error, setError] = useState<string | null>(null);
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
		setError(null);
		setBusy("deleting");
		if (onDelete(msg.id)) return;
		setBusy(null);
		setError(t("pending_delete_failed"));
	};
	return (
		<article
			aria-busy={busy !== null}
			className={`rounded-md border px-3 py-2.5 transition-colors ${
				msg.type === "delete"
					? "border-danger-border bg-danger-soft"
					: "border-border bg-panel hover:bg-input/50"
			}`}
			onMouseEnter={() => highlightElement(msg, true)}
			onMouseLeave={() => highlightElement(msg, false)}
		>
			<div className="flex min-w-0 items-start gap-2">
				<MessageScope msg={msg} />
				<div className="ml-auto flex shrink-0 items-center gap-0.5">
					<time className="mr-1 text-xs font-medium tabular-nums text-text-3">
						{formatTime(msg.ts)}
					</time>
					{canOpen && (
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
							className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-text-3 transition-colors hover:bg-panel hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
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
					<button
						type="button"
						aria-label={
							busy === "deleting"
								? t("pending_deleting")
								: t("pending_delete_note")
						}
						title={t("pending_delete_note")}
						onClick={deleteMessage}
						disabled={busy !== null}
						className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-text-3 transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50"
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
					<MessageBody msg={msg} />
				</div>
			</div>
			{error && (
				<p className="mt-2 text-xs font-medium text-danger" role="alert">
					{error}
				</p>
			)}
		</article>
	);
}

function MessageComposer({
	isTop,
	docName,
	note,
	saving,
	error,
	onChange,
	onSubmit,
}: {
	isTop: boolean;
	docName: string | null;
	note: string;
	saving: boolean;
	error: string | null;
	onChange: (value: string) => void;
	onSubmit: () => void;
}) {
	const t = useT();
	const positionClass = isTop ? "border-b order-first" : "border-t order-last";
	if (!docName) {
		return (
			<div className={`border-border/60 px-3 py-3 ${positionClass}`}>
				<p className="text-[13px] leading-[18px] text-text-2">
					{t("note_requires_document")}
				</p>
				<button
					type="button"
					onClick={() => useStore.getState().setLibraryView("docs")}
					className="mt-2 inline-flex h-8 items-center rounded-[7px] bg-input px-2.5 text-[13px] font-semibold text-text-1 transition hover:bg-accent-soft hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
				>
					{t("choose_document")}
				</button>
			</div>
		);
	}
	return (
		<div
			className={`flex flex-col gap-1.5 border-border/60 px-3 py-3 ${positionClass}`}
		>
			<div className="flex min-w-0 items-center gap-1 px-0.5 text-[13px] font-medium text-text-2">
				<FileText size={12} className="flex-shrink-0" />
				<span className="truncate">
					{t("new_note_scope", { scope: docName })}
				</span>
			</div>
			<div className="flex items-end gap-1.5">
				<textarea
					aria-label={t("note_global_placeholder")}
					aria-invalid={error ? true : undefined}
					value={note}
					onChange={(event) => onChange(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							onSubmit();
						}
					}}
					rows={3}
					placeholder={t("note_global_placeholder")}
					className="flex-1 min-w-0 px-3 py-2.5 bg-input rounded-lg text-[15px] leading-[21px] outline-none placeholder:text-text-3 focus:ring-2 focus:ring-accent/20 resize-none"
				/>
				<button
					type="button"
					onClick={onSubmit}
					disabled={!note.trim() || saving}
					aria-busy={saving}
					aria-label={t("pending_send_note")}
					title={t("pending_send_note")}
					className={`w-9 h-9 rounded-lg flex items-center justify-center transition flex-shrink-0 ${
						note.trim() && !saving
							? "bg-accent text-accent-contrast hover:brightness-110"
							: "bg-input text-text-3 cursor-not-allowed"
					}`}
				>
					{saving ? (
						<LoaderCircle
							size={14}
							className="animate-spin"
							aria-hidden="true"
						/>
					) : (
						<Send size={14} aria-hidden="true" />
					)}
				</button>
			</div>
			{saving && (
				<p className="text-xs font-medium text-text-2" aria-live="polite">
					{t("pending_sending")}
				</p>
			)}
			{error && (
				<p className="text-xs font-medium text-danger" role="alert">
					{error}
				</p>
			)}
		</div>
	);
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
// MessagesPanel is an adapter over the pending queue: queue ownership stays in Zustand while the panel only renders and dispatches UI commands.
export function MessagesPanel() {
	const t = useT();
	const [globalNote, setGlobalNote] = useState("");
	const [search, setSearch] = useState("");
	const [noteSaving, setNoteSaving] = useState(false);
	const [noteError, setNoteError] = useState<string | null>(null);
	const focusedDocName = useStore((s) => s.focusedDocName);
	const pending = useStore((s) => s.pending);
	const addPending = useStore((s) => s.addPending);
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

	const submitNote = async () => {
		const text = globalNote.trim();
		if (!text || noteSaving) return;
		setNoteSaving(true);
		setNoteError(null);
		const outcome = await addPending({
			id: crypto.randomUUID(),
			type: "note",
			text,
			ts: Date.now(),
		});
		setNoteSaving(false);
		if (!outcome.ok) {
			setNoteError(t("pending_create_failed"));
			return;
		}
		setGlobalNote((current) => (current.trim() === text ? "" : current));
	};

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
			</LibraryToolbar>
			<div
				data-messages-scroll
				onScroll={showLibraryScrollActivity}
				className="library-scroll-area flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-3"
			>
				{pending.length === 0 ? (
					<div className="flex-1 flex flex-col items-center justify-center gap-2 text-text-3 text-sm text-center px-4">
						<span className="w-10 h-10 rounded-full bg-input flex items-center justify-center">
							<MessageSquareText size={18} />
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
						<MessageCard key={msg.id} msg={msg} onDelete={removePending} />
					))
				)}
			</div>

			<MessageComposer
				isTop={false}
				docName={focusedDocName}
				note={globalNote}
				saving={noteSaving}
				error={noteError}
				onChange={(value) => {
					setGlobalNote(value);
					if (noteError) setNoteError(null);
				}}
				onSubmit={submitNote}
			/>
		</section>
	);
}
