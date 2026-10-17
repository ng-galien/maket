import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import { useMobileHistoryState } from "../lib/mobileHistory";
import { useStore } from "../store/useStore";
import { randomId } from "../utils";
import { MobileMessageComposer } from "./MobileMessageComposer";

/** UI adapter: general notes use the existing server-owned annotation queue. */
export function GeneralMessageComposer({
	open,
	onClose,
	onCreated,
}: {
	open: boolean;
	onClose: () => void;
	onCreated: () => void;
}) {
	const t = useT();
	const mobile = useStore((state) => state.mobileReading);
	const connected = useStore((state) => state.connected);
	const [text, setText] = useMobileHistoryState(
		"messages:general-draft",
		"",
		"context",
	);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const submitting = useRef(false);
	const field = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		if (!open) return;
		setError("");
		field.current?.focus();
	}, [open]);
	const send = async () => {
		if (!text.trim() || submitting.current || !connected) return;
		submitting.current = true;
		setSaving(true);
		setError("");
		const outcome = await createGeneralMessage(text);
		submitting.current = false;
		setSaving(false);
		if (!outcome.ok) {
			setError(outcome.error ?? t("pending_create_failed"));
			return;
		}
		setText("");
		onCreated();
	};
	if (!open) return null;
	const visibleError = error || (!connected ? t("maket_disconnected") : "");
	if (mobile)
		return (
			<MobileMessageComposer
				documentName={t("pending_general_scope")}
				value={text}
				onChange={setText}
				onCancel={onClose}
				onSubmit={send}
				saving={saving}
				disabled={!connected}
				error={visibleError}
			>
				<p className="text-sm text-text-2">{t("pending_read_later")}</p>
			</MobileMessageComposer>
		);
	return (
		<GeneralMessageForm
			model={{
				field,
				text,
				setText,
				saving,
				connected,
				visibleError,
				onClose,
				send,
			}}
		/>
	);
}

function GeneralMessageForm({
	model,
}: {
	model: {
		field: React.RefObject<HTMLTextAreaElement | null>;
		text: string;
		setText: (value: string) => void;
		saving: boolean;
		connected: boolean;
		visibleError: string;
		onClose: () => void;
		send: () => Promise<void>;
	};
}) {
	const t = useT();
	const {
		field,
		text,
		setText,
		saving,
		connected,
		visibleError,
		onClose,
		send,
	} = model;
	return (
		<form
			data-general-message-composer
			aria-label={t("pending_general_scope")}
			className="shrink-0 border-b border-border p-3"
			onSubmit={(event) => {
				event.preventDefault();
				void send();
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape" && !saving) {
					event.stopPropagation();
					onClose();
				}
			}}
		>
			<label className="flex flex-col gap-2 text-sm font-semibold">
				{t("pending_general_scope")}
				<textarea
					ref={field}
					value={text}
					onChange={(event) => setText(event.target.value)}
					readOnly={saving}
					rows={5}
					className="w-full resize-y rounded-lg border border-border bg-input p-3 text-base font-normal leading-6"
				/>
			</label>
			<p className="mt-2 text-xs text-text-2">{t("pending_read_later")}</p>
			{visibleError && (
				<p role="alert" className="mt-2 text-sm text-danger">
					{visibleError}
				</p>
			)}
			<div className="mt-3 flex justify-end gap-2">
				<button
					type="button"
					onClick={onClose}
					disabled={saving}
					className="min-h-10 rounded-lg px-3 text-sm text-text-2 disabled:opacity-40"
				>
					{t("cancel")}
				</button>
				<button
					type="submit"
					disabled={saving || !connected || !text.trim()}
					aria-busy={saving}
					className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-contrast disabled:opacity-40"
				>
					{saving ? t("pending_sending") : t("message_send")}
				</button>
			</div>
		</form>
	);
}

/** Explicit undefined scope prevents the queue from using the focused document. */
function createGeneralMessage(text: string) {
	return useStore.getState().addPending({
		id: randomId(),
		type: "note",
		docName: undefined,
		text: text.trim(),
		ts: Date.now(),
	});
}
