import type { AssetsListItem, AssetsListResponse } from "@maket/shared";
import {
	ArrowLeft,
	Copy,
	ImagePlus,
	MoreVertical,
	Search,
	Trash2,
	Upload,
	X,
} from "lucide-react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/useT";
import { useStore } from "../store/useStore";
import { wsSend } from "../store/ws";
import { HoldToDelete } from "./shared/HoldToDelete";

type ImageAsset = AssetsListItem;

type RowMode = { kind: "idle" } | { kind: "confirm-delete" };

async function copyToClipboard(text: string): Promise<boolean> {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		/* fall through */
	}
	return false;
}

export function PhotosTab() {
	const t = useT();
	const [images, setImages] = useState<ImageAsset[]>([]);
	const [activeFilter, setActiveFilter] = useState("Tous");
	const [loading, setLoading] = useState(true);
	const [selected, setSelected] = useState<ImageAsset | null>(null);
	const [search, setSearch] = useState("");
	const [menuFor, setMenuFor] = useState<string | null>(null);
	const [modeFor, setModeFor] = useState<{
		file: string;
		mode: RowMode;
	} | null>(null);
	const [checked, setChecked] = useState<Set<string>>(new Set());
	const [lastClicked, setLastClicked] = useState<string | null>(null);
	const [dragOver, setDragOver] = useState(false);
	const [uploadBtnDrag, setUploadBtnDrag] = useState(false);
	const [uploading, setUploading] = useState<{
		total: number;
		done: number;
		errors: string[];
	} | null>(null);
	const uploadInputRef = useRef<HTMLInputElement>(null);

	const fetchImages = useCallback(() => {
		setLoading(true);
		fetch("/api/assets")
			.then((r) => r.json() as Promise<AssetsListResponse>)
			.then((data) => {
				setImages(data.images || []);
				setLoading(false);
			})
			.catch(() => setLoading(false));
	}, []);

	useEffect(() => {
		fetchImages();
	}, [fetchImages]);

	useEffect(() => {
		const handler = () => fetchImages();
		window.addEventListener("assets-changed", handler);
		return () => window.removeEventListener("assets-changed", handler);
	}, [fetchImages]);

	// Escape clears the multi-selection.
	useEffect(() => {
		if (checked.size === 0) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setChecked(new Set());
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [checked.size]);

	const handleUpload = useCallback(
		async (files: FileList) => {
			const total = files.length;
			const state = { total, done: 0, errors: [] as string[] };
			setUploading({ ...state });

			await Promise.all(
				Array.from(files).map(async (file) => {
					const formData = new FormData();
					formData.append("file", file);
					try {
						const res = await fetch("/api/upload", {
							method: "POST",
							body: formData,
						});
						if (!res.ok) state.errors.push(file.name);
					} catch {
						state.errors.push(file.name);
					}
					state.done++;
					setUploading({ ...state });
				}),
			);

			const r = await fetch("/api/assets");
			const data = (await r.json()) as AssetsListResponse;
			setImages(data.images || []);

			const uploaded = Array.from(files)
				.map((f) => f.name)
				.filter((n) => !state.errors.includes(n));
			if (uploaded.length > 0) {
				// Workspace-scoped message — explicit `docName: undefined`
				// opts out of the focused-doc injection in addPending so the
				// server lands it in the workspace bucket and `maket_message
				// list` (no doc) picks it up.
				useStore.getState().addPending({
					id: crypto.randomUUID(),
					type: "classify-images",
					docName: undefined,
					text: t("pending_classify_images", {
						files: uploaded.join(", "),
						count: String(uploaded.length),
					}),
					ts: Date.now(),
				});
			}

			setTimeout(() => setUploading(null), state.errors.length ? 3000 : 800);
		},
		[t],
	);

	const openFilePicker = () => {
		if (uploading) return;
		uploadInputRef.current?.click();
	};

	const barPosition = useStore((s) => s.barPosition);

	// Detail view — replaces the grid
	if (selected) {
		return (
			<ImageDetail
				img={selected}
				onClose={() => setSelected(null)}
				onDelete={(file) => {
					wsSend({ type: "delete_asset", filename: file });
					setSelected(null);
				}}
				onInsert={
					useStore.getState().focusedDocName
						? (file) => {
								useStore.getState().addPending({
									id: crypto.randomUUID(),
									type: "drop-image",
									file,
									text: t("pending_insert_image", { file }),
									ts: Date.now(),
								});
								setSelected(null);
							}
						: null
				}
			/>
		);
	}

	const q = search.trim().toLowerCase();
	const searched = q
		? images.filter((img) => {
				if (img.file.toLowerCase().includes(q)) return true;
				if (img.title?.toLowerCase().includes(q)) return true;
				if (img.description?.toLowerCase().includes(q)) return true;
				if (img.tags?.some((tag) => tag.toLowerCase().includes(q))) return true;
				return false;
			})
		: images;

	const categories = [
		"Tous",
		...new Set(images.map((img) => img.category || "").filter(Boolean)),
	];
	const filtered =
		activeFilter === "Tous"
			? searched
			: searched.filter((img) => img.category === activeFilter);

	const flatOrder = filtered.map((i) => i.file);

	const handleTileClick = (img: ImageAsset, e: React.MouseEvent) => {
		if (e.metaKey || e.ctrlKey) {
			e.preventDefault();
			setChecked((prev) => {
				const next = new Set(prev);
				if (next.has(img.file)) next.delete(img.file);
				else next.add(img.file);
				return next;
			});
			setLastClicked(img.file);
			return;
		}
		if (e.shiftKey && lastClicked) {
			e.preventDefault();
			const from = flatOrder.indexOf(lastClicked);
			const to = flatOrder.indexOf(img.file);
			if (from >= 0 && to >= 0) {
				const [lo, hi] = from < to ? [from, to] : [to, from];
				setChecked((prev) => {
					const next = new Set(prev);
					for (let i = lo; i <= hi; i++) {
						const n = flatOrder[i];
						if (n) next.add(n);
					}
					return next;
				});
			}
			return;
		}
		if (checked.size > 0) {
			setChecked(new Set());
		}
		setLastClicked(img.file);
		setSelected(img);
	};

	const bulkDelete = () => {
		for (const file of checked)
			wsSend({ type: "delete_asset", filename: file });
		setChecked(new Set());
	};

	return (
		<div
			className={`flex ${barPosition === "bottom" ? "flex-col-reverse" : "flex-col"} gap-3 p-3`}
		>
			{/* Header — search + upload */}
			<div className="flex items-center gap-1.5">
				<div className="relative flex-1 min-w-0">
					<Search
						size={13}
						className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3 pointer-events-none"
					/>
					<input
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder={t("photo_search_hint")}
						className="w-full pl-8 pr-8 py-2 bg-input rounded-lg text-base outline-none placeholder:text-text-3 focus:ring-2 focus:ring-accent/20"
					/>
					{search && (
						<button
							type="button"
							onClick={() => setSearch("")}
							aria-label="Clear"
							className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-md flex items-center justify-center text-text-3 hover:text-text-1 hover:bg-black/[0.06] transition"
						>
							<X size={12} />
						</button>
					)}
				</div>
				<input
					ref={uploadInputRef}
					type="file"
					accept="image/*"
					multiple
					className="hidden"
					onChange={(e) => {
						if (e.target.files?.length) handleUpload(e.target.files);
						e.target.value = "";
					}}
				/>
				<button
					type="button"
					onClick={openFilePicker}
					onDragOver={(e) => {
						if (!e.dataTransfer.types.includes("Files")) return;
						e.preventDefault();
						e.dataTransfer.dropEffect = "copy";
						if (!uploadBtnDrag) setUploadBtnDrag(true);
					}}
					onDragLeave={() => setUploadBtnDrag(false)}
					onDrop={(e) => {
						e.preventDefault();
						setUploadBtnDrag(false);
						if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files);
					}}
					aria-label={t("photo_upload")}
					title={t("photo_upload")}
					className={`w-8 h-8 rounded-lg flex items-center justify-center transition ${
						uploadBtnDrag
							? "bg-accent-soft text-accent ring-2 ring-accent/40"
							: "bg-input text-text-3 hover:text-text-1"
					}`}
				>
					<Upload size={14} />
				</button>
			</div>

			{/* Upload progress bar (inline, replaces drag-drop zone while uploading) */}
			{uploading && (
				<div className="mx-1 px-3 py-2 rounded-lg bg-accent-soft">
					<div className="h-1.5 rounded-full bg-white/50 overflow-hidden">
						<div
							className="h-full bg-accent rounded-full transition-all duration-300"
							style={{
								width: `${(uploading.done / uploading.total) * 100}%`,
							}}
						/>
					</div>
					<div className="text-xs font-semibold text-accent mt-1.5 tabular-nums">
						{t("upload_progress", {
							done: String(uploading.done),
							total: String(uploading.total),
						})}
					</div>
					{uploading.errors.length > 0 && (
						<div className="text-xs text-danger mt-0.5">
							{uploading.errors
								.map((f) => t("upload_error", { file: f }))
								.join(", ")}
						</div>
					)}
				</div>
			)}

			{/* Category filter chips */}
			{categories.length > 1 && (
				<div className="flex gap-1.5 flex-wrap">
					{categories.map((f) => (
						<button
							key={f}
							type="button"
							onClick={() => setActiveFilter(f)}
							className={`text-xs font-semibold px-3 py-1 rounded-full transition ${
								activeFilter === f
									? "bg-accent/15 text-accent ring-1 ring-accent/20"
									: "bg-input text-text-3 hover:text-text-1"
							}`}
						>
							{f}
						</button>
					))}
				</div>
			)}

			{/* Content */}
			{loading ? (
				<div className="text-center text-text-3 text-xs py-6">
					{t("loading")}
				</div>
			) : images.length === 0 ? (
				<EmptyDropZone
					dragOver={dragOver}
					onOpenPicker={openFilePicker}
					onDragOver={(e) => {
						e.preventDefault();
						e.stopPropagation();
						setDragOver(true);
					}}
					onDragLeave={() => setDragOver(false)}
					onDrop={(e) => {
						e.preventDefault();
						setDragOver(false);
						if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files);
					}}
				/>
			) : filtered.length === 0 ? (
				<div className="px-4 py-6 text-center text-base text-text-3">
					{t("photo_no_match")}
				</div>
			) : (
				<div
					className="grid grid-cols-2 gap-2"
					onDragOver={(e) => {
						if (!e.dataTransfer.types.includes("Files")) return;
						e.preventDefault();
						setDragOver(true);
					}}
					onDragLeave={() => setDragOver(false)}
					onDrop={(e) => {
						if (!e.dataTransfer.files.length) return;
						e.preventDefault();
						setDragOver(false);
						handleUpload(e.dataTransfer.files);
					}}
				>
					{filtered.map((img) => (
						<PhotoTile
							key={img.file}
							img={img}
							isChecked={checked.has(img.file)}
							onClick={(e) => handleTileClick(img, e)}
							menuOpen={menuFor === img.file}
							onMenuOpen={() => setMenuFor(img.file)}
							onMenuClose={() => setMenuFor(null)}
							mode={
								modeFor?.file === img.file
									? modeFor.mode
									: ({ kind: "idle" } as RowMode)
							}
							onModeChange={(mode) =>
								setModeFor(
									mode.kind === "idle" ? null : { file: img.file, mode },
								)
							}
						/>
					))}
				</div>
			)}

			{/* Global drop overlay — dim overlay when dragging files onto the grid */}
			{dragOver && images.length > 0 && (
				<div className="fixed inset-0 bg-accent/10 pointer-events-none z-50 ring-4 ring-accent/40 ring-inset" />
			)}

			{checked.size > 0 && (
				<BulkBar
					count={checked.size}
					onClear={() => setChecked(new Set())}
					onDelete={bulkDelete}
				/>
			)}
		</div>
	);
}

function EmptyDropZone({
	dragOver,
	onOpenPicker,
	onDragOver,
	onDragLeave,
	onDrop,
}: {
	dragOver: boolean;
	onOpenPicker: () => void;
	onDragOver: (e: React.DragEvent) => void;
	onDragLeave: () => void;
	onDrop: (e: React.DragEvent) => void;
}) {
	const t = useT();
	return (
		<button
			type="button"
			onClick={onOpenPicker}
			onDragOver={onDragOver}
			onDragLeave={onDragLeave}
			onDrop={onDrop}
			className={`py-10 px-6 border-2 border-dashed rounded-xl text-center transition-all ${
				dragOver
					? "border-accent bg-accent-soft text-accent scale-[1.01]"
					: "border-border bg-input/40 text-text-3 hover:border-accent-border hover:bg-accent-soft hover:text-accent"
			}`}
		>
			<div className="w-12 h-12 mx-auto rounded-full bg-panel flex items-center justify-center mb-3 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
				<ImagePlus size={20} />
			</div>
			<div className="text-sm font-bold mb-1">{t("no_image")}</div>
			<div className="text-xs leading-relaxed">{t("upload_drop")}</div>
		</button>
	);
}

interface PhotoTileProps {
	img: ImageAsset;
	isChecked: boolean;
	onClick: (e: React.MouseEvent) => void;
	menuOpen: boolean;
	onMenuOpen: () => void;
	onMenuClose: () => void;
	mode: RowMode;
	onModeChange: (mode: RowMode) => void;
}

function PhotoTile({
	img,
	isChecked,
	onClick,
	menuOpen,
	onMenuOpen,
	onMenuClose,
	mode,
	onModeChange,
}: PhotoTileProps) {
	const t = useT();
	const menuBtnRef = useRef<HTMLButtonElement>(null);
	const confirming = mode.kind === "confirm-delete";
	const hasDoc = useStore((s) => s.focusedDocName !== null);

	const onInsert = () => {
		const focused = useStore.getState().focusedDocName;
		if (!focused) return;
		useStore.getState().addPending({
			id: crypto.randomUUID(),
			type: "drop-image",
			file: img.file,
			text: t("pending_insert_image", { file: img.file }),
			ts: Date.now(),
		});
	};

	return (
		<div className="relative group/tile">
			<button
				type="button"
				onClick={onClick}
				className={`aspect-[4/3] w-full rounded-lg relative overflow-hidden transition-transform outline-none ${
					isChecked
						? "ring-4 ring-accent ring-offset-2 ring-offset-panel"
						: "hover:scale-[1.02]"
				}`}
			>
				<img
					src={`/assets/thumb/${img.file}`}
					alt={img.title || img.file}
					className="w-full h-full object-cover"
					loading="lazy"
					decoding="async"
					draggable={false}
				/>

				{/* Checked badge — top-right */}
				{isChecked && (
					<span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-md bg-accent text-white flex items-center justify-center text-2xs font-bold">
						✓
					</span>
				)}

				{/* Dimension / orientation badge — bottom-left, only on hover */}
				{(img.width && img.height) || img.orientation ? (
					<span className="absolute bottom-1.5 left-1.5 text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-md bg-black/55 text-white opacity-0 group-hover/tile:opacity-100 transition-opacity backdrop-blur-sm">
						{img.width && img.height
							? `${img.width}×${img.height}`
							: img.orientation}
					</span>
				) : null}

				{/* Title bar — bottom, only on hover (and when not confirming) */}
				{!confirming && (
					<div className="absolute inset-x-0 bottom-0 px-2 py-1.5 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover/tile:opacity-100 transition-opacity">
						<span className="text-2xs font-semibold text-white truncate block">
							{img.title || img.file}
						</span>
					</div>
				)}
			</button>

			{/* Confirm-delete overlay — covers the tile */}
			{confirming && (
				<div className="absolute inset-0 rounded-lg bg-panel/95 backdrop-blur-sm p-1 flex items-center">
					<HoldToDelete
						label={t("photo_delete_hold")}
						onConfirm={() => {
							onModeChange({ kind: "idle" });
							wsSend({ type: "delete_asset", filename: img.file });
						}}
						onCancel={() => onModeChange({ kind: "idle" })}
					/>
				</div>
			)}

			{/* Quick-action buttons — top-left on hover */}
			{!confirming && (
				<div className="absolute top-1.5 left-1.5 flex gap-1 opacity-0 group-hover/tile:opacity-100 transition-opacity">
					{hasDoc && (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onInsert();
							}}
							aria-label={t("insert_in_doc")}
							title={t("insert_in_doc")}
							className="w-7 h-7 rounded-md bg-black/55 backdrop-blur-sm text-white flex items-center justify-center hover:bg-accent transition"
						>
							<ImagePlus size={13} />
						</button>
					)}
					<button
						ref={menuBtnRef}
						type="button"
						aria-label={t("photo_menu")}
						onClick={(e) => {
							e.stopPropagation();
							if (menuOpen) onMenuClose();
							else onMenuOpen();
						}}
						className={`w-7 h-7 rounded-md backdrop-blur-sm flex items-center justify-center transition ${
							menuOpen
								? "bg-black/70 text-white"
								: "bg-black/55 text-white hover:bg-black/70"
						}`}
					>
						<MoreVertical size={13} />
					</button>
				</div>
			)}

			{menuOpen && (
				<PhotoMenu
					img={img}
					hasDoc={hasDoc}
					anchorRef={menuBtnRef}
					onClose={onMenuClose}
					onInsert={onInsert}
					onDeleteRequest={() => {
						onMenuClose();
						onModeChange({ kind: "confirm-delete" });
					}}
				/>
			)}
		</div>
	);
}

interface PhotoMenuProps {
	img: ImageAsset;
	hasDoc: boolean;
	anchorRef: React.RefObject<HTMLElement | null>;
	onClose: () => void;
	onInsert: () => void;
	onDeleteRequest: () => void;
}

function PhotoMenu({
	img,
	hasDoc,
	anchorRef,
	onClose,
	onInsert,
	onDeleteRequest,
}: PhotoMenuProps) {
	const t = useT();
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

	useLayoutEffect(() => {
		const a = anchorRef.current;
		if (!a) return;
		const rect = a.getBoundingClientRect();
		const MENU_W = 200;
		const GAP = 4;
		const top = rect.bottom + GAP;
		const left = Math.max(
			8,
			Math.min(rect.left, window.innerWidth - MENU_W - 8),
		);
		setPos({ top, left });
	}, [anchorRef]);

	useEffect(() => {
		const onDocClick = (e: MouseEvent) => {
			if (ref.current?.contains(e.target as Node)) return;
			if (anchorRef.current?.contains(e.target as Node)) return;
			onClose();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		const onScroll = () => onClose();
		document.addEventListener("mousedown", onDocClick);
		document.addEventListener("keydown", onKey);
		window.addEventListener("scroll", onScroll, true);
		window.addEventListener("resize", onScroll);
		return () => {
			document.removeEventListener("mousedown", onDocClick);
			document.removeEventListener("keydown", onKey);
			window.removeEventListener("scroll", onScroll, true);
			window.removeEventListener("resize", onScroll);
		};
	}, [onClose, anchorRef]);

	if (!pos) return null;

	const handleCopy = async () => {
		await copyToClipboard(img.file);
		onClose();
	};

	return createPortal(
		<div
			ref={ref}
			className="fixed z-[210] bg-panel rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.18)] border border-black/5 overflow-hidden py-1"
			style={{ top: pos.top, left: pos.left, width: 200 }}
		>
			{hasDoc && (
				<MenuItem
					icon={<ImagePlus size={13} />}
					onClick={() => {
						onInsert();
						onClose();
					}}
				>
					{t("insert_in_doc")}
				</MenuItem>
			)}
			<MenuItem icon={<Copy size={13} />} onClick={handleCopy}>
				{t("photo_copy_filename")}
			</MenuItem>
			<div className="h-px bg-black/[0.06] my-1" />
			<MenuItem icon={<Trash2 size={13} />} onClick={onDeleteRequest} danger>
				{t("doc_delete")}
			</MenuItem>
		</div>,
		document.body,
	);
}

interface MenuItemProps {
	icon: React.ReactNode;
	children: React.ReactNode;
	onClick: () => void;
	danger?: boolean;
}

function MenuItem({ icon, children, onClick, danger }: MenuItemProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left transition ${
				danger
					? "text-danger hover:bg-danger-soft"
					: "text-text-1 hover:bg-black/[0.05]"
			}`}
		>
			<span className="flex-shrink-0">{icon}</span>
			<span className="flex-1 truncate">{children}</span>
		</button>
	);
}

interface BulkBarProps {
	count: number;
	onClear: () => void;
	onDelete: () => void;
}

function BulkBar({ count, onClear, onDelete }: BulkBarProps) {
	const t = useT();
	const [confirm, setConfirm] = useState(false);

	return (
		<div className="sticky bottom-2 mx-1 mt-2 rounded-xl bg-panel shadow-[0_12px_40px_rgba(0,0,0,0.18)] border border-black/5 p-2 flex items-center gap-1.5 z-40">
			<span className="px-2 text-2xs font-bold text-text-3 tabular-nums">
				{t("bulk_selected", { count: String(count) })}
			</span>
			<div className="flex-1 min-w-0 flex items-center gap-1">
				{confirm ? (
					<button
						type="button"
						onClick={() => {
							setConfirm(false);
							onDelete();
						}}
						className="px-2 py-1 rounded-md text-xs font-bold bg-danger text-white hover:brightness-110 transition"
					>
						{t("bulk_confirm_delete")}
					</button>
				) : (
					<button
						type="button"
						onClick={() => setConfirm(true)}
						className="px-2 py-1 rounded-md text-xs font-semibold text-danger hover:bg-danger-soft transition"
					>
						{t("doc_delete")}
					</button>
				)}
			</div>
			<button
				type="button"
				onClick={onClear}
				aria-label={t("bulk_clear")}
				className="w-7 h-7 rounded-md flex items-center justify-center text-text-3 hover:bg-black/[0.05] transition"
			>
				<span aria-hidden className="text-base leading-none">
					×
				</span>
			</button>
		</div>
	);
}

function ImageDetail({
	img,
	onClose,
	onInsert,
	onDelete,
}: {
	img: ImageAsset;
	onClose: () => void;
	onInsert: ((file: string) => void) | null;
	onDelete: (file: string) => void;
}) {
	const t = useT();
	const [confirming, setConfirming] = useState(false);

	return (
		<div className="flex flex-col gap-3 p-3">
			{/* Back + title */}
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={onClose}
					className="p-1.5 rounded-lg text-text-3 hover:text-text-1 hover:bg-input transition"
				>
					<ArrowLeft size={16} />
				</button>
				<div className="flex-1 min-w-0">
					<div className="text-md font-bold truncate">
						{img.title || img.file}
					</div>
					<div className="text-xs text-text-3 truncate">{img.file}</div>
				</div>
			</div>

			{/* Image preview */}
			<div className="rounded-xl overflow-hidden bg-black/5">
				<img
					src={`/assets/${img.file}`}
					alt={img.title || img.file}
					className="w-full max-h-[250px] object-contain"
				/>
			</div>

			{img.description && (
				<p className="text-sm text-text-2 leading-relaxed">{img.description}</p>
			)}

			<div className="flex flex-wrap gap-2">
				{img.width && img.height && (
					<span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-input text-text-2 tabular-nums">
						{img.width} × {img.height}
					</span>
				)}
				{img.orientation && (
					<span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-input text-text-2">
						{img.orientation}
					</span>
				)}
				{img.category && (
					<span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-accent-soft text-accent">
						{img.category}
					</span>
				)}
			</div>

			{img.tags && Array.isArray(img.tags) && img.tags.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{img.tags.map((tag: string) => (
						<span
							key={tag}
							className="text-2xs font-medium px-2 py-0.5 rounded-full bg-input text-text-3"
						>
							{tag}
						</span>
					))}
				</div>
			)}

			{/* Actions */}
			{confirming ? (
				<HoldToDelete
					label={t("photo_delete_hold")}
					onConfirm={() => {
						setConfirming(false);
						onDelete(img.file);
					}}
					onCancel={() => setConfirming(false)}
				/>
			) : (
				<div className="flex gap-2">
					{onInsert && (
						<button
							type="button"
							onClick={() => onInsert(img.file)}
							className="flex-1 py-2.5 rounded-xl text-base font-semibold bg-accent text-white hover:brightness-110 transition flex items-center justify-center gap-2"
						>
							<ImagePlus size={16} />
							{t("insert_in_doc")}
						</button>
					)}
					<button
						type="button"
						onClick={() => setConfirming(true)}
						className="py-2.5 px-3 rounded-xl text-base font-semibold border border-danger-border text-danger hover:bg-danger-soft transition flex items-center justify-center"
					>
						<Trash2 size={16} />
					</button>
				</div>
			)}
		</div>
	);
}
