import {
	Copy,
	Files,
	FileText,
	Lock,
	MoreVertical,
	Pencil,
	Trash2,
	Unlock,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import type { DocSummary } from "../store/types";
import { useStore, useWorkspaceDocNames } from "../store/useStore";
import {
	sendDeleteDoc,
	sendDuplicateDoc,
	sendLoadDoc,
	sendLockDoc,
	sendRenameDoc,
} from "../store/ws";

// Category color by hash
function catColor(cat: string): string {
	const COLORS = [
		"#60a5fa",
		"#a78bfa",
		"#f59e0b",
		"#10b981",
		"#f472b6",
		"#34d399",
		"#fb923c",
	];
	let h = 0;
	for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) | 0;
	return COLORS[Math.abs(h) % COLORS.length];
}

async function copyToClipboard(text: string): Promise<boolean> {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		/* fall through to execCommand */
	}
	try {
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.style.position = "fixed";
		ta.style.opacity = "0";
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand("copy");
		ta.remove();
		return ok;
	} catch {
		return false;
	}
}

export function DocsTab() {
	const t = useT();
	const docList = useStore((s) => s.docList);
	const workspaceDocNames = useWorkspaceDocNames();
	const barPosition = useStore((s) => s.barPosition);
	const removeDoc = useStore((s) => s.removeDocFromWorkspace);
	const [search, setSearch] = useState("");
	const [menuFor, setMenuFor] = useState<string | null>(null);

	const filtered = docList.filter((d) =>
		d.name.toLowerCase().includes(search.toLowerCase()),
	);

	// Group by category
	const grouped = new Map<string, typeof docList>();
	for (const d of filtered) {
		const cat = d.category || "general";
		if (!grouped.has(cat)) grouped.set(cat, []);
		grouped.get(cat)?.push(d);
	}

	const isOnWorkspace = (name: string) => workspaceDocNames.includes(name);

	const toggleDoc = (name: string) => {
		if (isOnWorkspace(name)) {
			removeDoc(name);
		} else {
			sendLoadDoc(name);
		}
	};

	return (
		<div
			className={`flex ${barPosition === "bottom" ? "flex-col-reverse" : "flex-col"} gap-2 p-3`}
		>
			{/* Search */}
			<div className="px-1">
				<input
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					placeholder={t("search")}
					className="w-full px-3 py-2 bg-input rounded-lg text-base outline-none placeholder:text-text-3 focus:ring-2 focus:ring-accent/20"
				/>
			</div>

			{/* Categories */}
			{[...grouped.entries()].map(([cat, docs]) => (
				<div key={cat}>
					{/* Category header */}
					<div className="flex items-center gap-2 px-2 py-1.5">
						<div
							style={{
								width: 8,
								height: 8,
								borderRadius: "50%",
								background: catColor(cat),
								flexShrink: 0,
							}}
						/>
						<span className="text-xs font-bold text-text-3 uppercase tracking-wider flex-1">
							{cat}
						</span>
						<span className="text-xs text-text-3">{docs.length}</span>
					</div>

					{/* Doc list */}
					<div className="flex flex-col gap-0.5">
						{docs.map((d) => (
							<DocRow
								key={d.name}
								doc={d}
								onWs={isOnWorkspace(d.name)}
								onToggle={() => toggleDoc(d.name)}
								menuOpen={menuFor === d.name}
								onMenuOpen={() => setMenuFor(d.name)}
								onMenuClose={() => setMenuFor(null)}
								canDelete={docList.length > 1}
							/>
						))}
					</div>
				</div>
			))}

			{filtered.length === 0 && (
				<div className="px-4 py-6 text-center text-base text-text-3">
					{t("no_document")}
				</div>
			)}
		</div>
	);
}

interface DocRowProps {
	doc: DocSummary;
	onWs: boolean;
	onToggle: () => void;
	menuOpen: boolean;
	onMenuOpen: () => void;
	onMenuClose: () => void;
	canDelete: boolean;
}

function DocRow({
	doc,
	onWs,
	onToggle,
	menuOpen,
	onMenuOpen,
	onMenuClose,
	canDelete,
}: DocRowProps) {
	const t = useT();
	const locked = doc.locked === true;

	return (
		<div className="relative group">
			<button
				type="button"
				onClick={onToggle}
				className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all ${
					onWs ? "bg-accent/5" : "hover:bg-black/[0.03]"
				}`}
			>
				<div
					className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${
						onWs ? "bg-accent/10" : "bg-input"
					}`}
				>
					<FileText
						size={14}
						className={onWs ? "text-accent" : "text-text-3"}
					/>
				</div>
				<div className="flex-1 min-w-0">
					<div
						className={`text-base truncate flex items-center gap-1.5 ${onWs ? "font-bold text-accent" : "font-medium text-text-1"}`}
					>
						{locked && (
							<Lock
								size={11}
								className="text-text-3 flex-shrink-0"
								aria-label={t("doc_locked")}
							/>
						)}
						<span className="truncate">{doc.name}</span>
					</div>
					<div className="flex items-center gap-1.5 mt-0.5">
						<span className="text-2xs font-bold text-text-3">{doc.format}</span>
						<span className="text-2xs text-text-3">{doc.pageCount ?? 1}p</span>
					</div>
				</div>
				{onWs && !menuOpen && (
					<span className="text-2xs font-bold text-accent mr-6">✓</span>
				)}
			</button>
			<button
				type="button"
				aria-label={t("doc_menu")}
				onClick={(e) => {
					e.stopPropagation();
					if (menuOpen) onMenuClose();
					else onMenuOpen();
				}}
				className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md flex items-center justify-center text-text-3 hover:bg-black/[0.06] transition ${
					menuOpen
						? "bg-black/[0.06]"
						: "opacity-0 group-hover:opacity-100 focus:opacity-100"
				}`}
			>
				<MoreVertical size={14} />
			</button>
			{menuOpen && (
				<DocMenu
					doc={doc}
					onClose={onMenuClose}
					canDelete={canDelete}
					locked={locked}
				/>
			)}
		</div>
	);
}

interface DocMenuProps {
	doc: DocSummary;
	onClose: () => void;
	canDelete: boolean;
	locked: boolean;
}

function DocMenu({ doc, onClose, canDelete, locked }: DocMenuProps) {
	const t = useT();
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const onDocClick = (e: MouseEvent) => {
			if (!ref.current?.contains(e.target as Node)) onClose();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("mousedown", onDocClick);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDocClick);
			document.removeEventListener("keydown", onKey);
		};
	}, [onClose]);

	const handleCopy = async () => {
		await copyToClipboard(doc.name);
		onClose();
	};

	const handleRename = () => {
		const next = window.prompt(t("doc_rename_prompt"), doc.name);
		onClose();
		if (!next) return;
		const trimmed = next.trim();
		if (!trimmed || trimmed === doc.name) return;
		sendRenameDoc(doc.name, trimmed);
	};

	const handleDuplicate = () => {
		const next = window.prompt(t("doc_duplicate_prompt"), `${doc.name} copy`);
		onClose();
		if (!next) return;
		const trimmed = next.trim();
		if (!trimmed) return;
		sendDuplicateDoc(doc.name, trimmed);
	};

	const handleLock = () => {
		sendLockDoc(doc.name, !locked);
		onClose();
	};

	const handleDelete = () => {
		onClose();
		if (!canDelete) return;
		if (!window.confirm(t("doc_delete_confirm", { name: doc.name }))) return;
		sendDeleteDoc(doc.name);
	};

	return (
		<div
			ref={ref}
			className="absolute right-1.5 top-[calc(100%-4px)] z-50 w-48 bg-panel rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.18)] overflow-hidden py-1"
		>
			<MenuItem icon={<Copy size={13} />} onClick={handleCopy}>
				{t("doc_copy_name")}
			</MenuItem>
			<MenuItem
				icon={<Pencil size={13} />}
				onClick={handleRename}
				disabled={locked}
			>
				{t("doc_rename")}
			</MenuItem>
			<MenuItem icon={<Files size={13} />} onClick={handleDuplicate}>
				{t("doc_duplicate")}
			</MenuItem>
			<MenuItem
				icon={locked ? <Unlock size={13} /> : <Lock size={13} />}
				onClick={handleLock}
			>
				{locked ? t("doc_unlock") : t("doc_lock")}
			</MenuItem>
			<div className="h-px bg-black/[0.06] my-1" />
			<MenuItem
				icon={<Trash2 size={13} />}
				onClick={handleDelete}
				disabled={locked || !canDelete}
				danger
			>
				{t("doc_delete")}
			</MenuItem>
		</div>
	);
}

interface MenuItemProps {
	icon: React.ReactNode;
	children: React.ReactNode;
	onClick: () => void;
	disabled?: boolean;
	danger?: boolean;
}

function MenuItem({
	icon,
	children,
	onClick,
	disabled,
	danger,
}: MenuItemProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left transition ${
				disabled
					? "text-text-3 cursor-not-allowed"
					: danger
						? "text-danger hover:bg-danger-soft"
						: "text-text-1 hover:bg-black/[0.05]"
			}`}
		>
			<span className="flex-shrink-0">{icon}</span>
			<span className="flex-1 truncate">{children}</span>
		</button>
	);
}
