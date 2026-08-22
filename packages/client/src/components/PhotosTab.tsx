import type { AssetsListItem, AssetsListResponse } from "@maket/shared";
import {
	ArrowLeft,
	Copy,
	ImagePlus,
	MoreVertical,
	Trash2,
	Upload,
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
import type { PendingMessage } from "../store/useStore";
import { useStore } from "../store/useStore";
import { wsSend } from "../store/ws";
import { copyToClipboard } from "../utils";
import { HoldToDelete } from "./shared/HoldToDelete";
import { LibrarySearchField } from "./shared/LibrarySearchField";
import {
	LibraryToolbar,
	LibraryToolbarActions,
	LibraryToolbarRow,
} from "./shared/LibraryToolbar";

type ImageAsset = AssetsListItem;

type RowMode = { kind: "idle" } | { kind: "confirm-delete" };

function focusedWorkspaceDocumentName(
	state: ReturnType<typeof useStore.getState>,
): string | null {
	const name = state.focusedDocName;
	return name && state.workspaceDocNames.includes(name) && state.docs.has(name)
		? name
		: null;
}

export function PhotosTab() {
	const model = usePhotosTabModel();
	if (model.selected) {
		return (
			<ImageDetail
				img={model.selected}
				onClose={() => model.setSelected(null)}
				onDelete={model.deleteSelected}
				onInsert={model.insertSelected}
				error={model.annotationError}
			/>
		);
	}
	return <PhotosTabView model={model} />;
}

function usePhotoAssets() {
	const [images, setImages] = useState<ImageAsset[]>([]);
	const [loading, setLoading] = useState(true);
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
	return { images, setImages, loading };
}

function usePhotoUpload(
	t: ReturnType<typeof useT>,
	setImages: (images: ImageAsset[]) => void,
	clearAnnotationError: () => void,
	onAnnotationError: () => void,
) {
	const [uploadBtnDrag, setUploadBtnDrag] = useState(false);
	const [uploading, setUploading] = useState<{
		total: number;
		done: number;
		errors: string[];
	} | null>(null);
	const uploadInputRef = useRef<HTMLInputElement>(null);
	const handleUpload = useCallback(
		async (files: FileList) => {
			const selectedFiles = Array.from(files);
			clearAnnotationError();
			const state = {
				total: selectedFiles.length,
				done: 0,
				errors: [] as string[],
			};
			setUploading({ ...state });
			await uploadFiles(selectedFiles, state, setUploading);
			const r = await fetch("/api/assets");
			const data = (await r.json()) as AssetsListResponse;
			setImages(data.images || []);
			const classified = await queueImageClassification(
				selectedFiles,
				state.errors,
				t,
			);
			if (!classified) onAnnotationError();
			setTimeout(() => setUploading(null), state.errors.length ? 3000 : 800);
		},
		[clearAnnotationError, onAnnotationError, setImages, t],
	);
	const openFilePicker = () => {
		if (uploading) return;
		uploadInputRef.current?.click();
	};
	return {
		uploadBtnDrag,
		setUploadBtnDrag,
		uploading,
		uploadInputRef,
		handleUpload,
		openFilePicker,
	};
}

async function uploadFiles(
	files: readonly File[],
	state: { total: number; done: number; errors: string[] },
	setUploading: (state: {
		total: number;
		done: number;
		errors: string[];
	}) => void,
): Promise<void> {
	await Promise.all(
		files.map(async (file) => {
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
}

async function queueImageClassification(
	files: readonly File[],
	errors: string[],
	t: ReturnType<typeof useT>,
): Promise<boolean> {
	const uploaded = files.map((f) => f.name).filter((n) => !errors.includes(n));
	if (uploaded.length === 0) return true;
	const outcome = await useStore.getState().addPending({
		id: crypto.randomUUID(),
		type: "classify-images",
		docName: undefined,
		text: t("pending_classify_images", {
			files: uploaded.join(", "),
			count: String(uploaded.length),
		}),
		ts: Date.now(),
	});
	return outcome.ok;
}

function usePhotoFilters(images: ImageAsset[], search: string) {
	const [activeFilter, setActiveFilter] = useState("Tous");
	const q = search.trim().toLowerCase();
	const searched = q
		? images.filter((img) => photoMatchesQuery(img, q))
		: images;
	const categories = [
		"Tous",
		...new Set(images.map((img) => img.category || "").filter(Boolean)),
	];
	const filtered =
		activeFilter === "Tous"
			? searched
			: searched.filter((img) => img.category === activeFilter);
	return { activeFilter, setActiveFilter, categories, filtered };
}

function photoMatchesQuery(img: ImageAsset, query: string): boolean {
	if (img.file.toLowerCase().includes(query)) return true;
	if (img.title?.toLowerCase().includes(query)) return true;
	if (img.description?.toLowerCase().includes(query)) return true;
	return img.tags?.some((tag) => tag.toLowerCase().includes(query)) ?? false;
}

function usePhotoRequests(t: ReturnType<typeof useT>) {
	const [error, setError] = useState<string | null>(null);
	const reportError = useCallback(
		() => setError(t("pending_create_failed")),
		[t],
	);
	const clearError = useCallback(() => setError(null), []);
	const create = useCallback(
		async (message: PendingMessage): Promise<boolean> => {
			clearError();
			const outcome = await useStore.getState().addPending(message);
			if (outcome.ok) return true;
			reportError();
			return false;
		},
		[clearError, reportError],
	);
	const insertImage = useCallback(
		(file: string) =>
			create({
				id: crypto.randomUUID(),
				type: "drop-image",
				file,
				text: t("pending_insert_image", { file }),
				ts: Date.now(),
			}),
		[create, t],
	);
	return { error, reportError, clearError, insertImage };
}

function usePhotosTabModel() {
	const t = useT();
	const focusedDocName = useStore(focusedWorkspaceDocumentName);
	const requests = usePhotoRequests(t);
	const assets = usePhotoAssets();
	const upload = usePhotoUpload(
		t,
		assets.setImages,
		requests.clearError,
		requests.reportError,
	);
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

	useEffect(() => {
		if (checked.size === 0) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setChecked(new Set());
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [checked.size]);

	const filters = usePhotoFilters(assets.images, search);
	const flatOrder = filters.filtered.map((i) => i.file);

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

	const photoItemFor = (img: ImageAsset): PhotoTileProps => ({
		model: {
			img,
			checked: checked.has(img.file),
			menuOpen: menuFor === img.file,
			mode:
				modeFor?.file === img.file
					? modeFor.mode
					: ({ kind: "idle" } as RowMode),
		},
		actions: {
			click: (e) => handleTileClick(img, e),
			openMenu: () => setMenuFor(img.file),
			closeMenu: () => setMenuFor(null),
			changeMode: (mode) =>
				setModeFor(mode.kind === "idle" ? null : { file: img.file, mode }),
			insert: requests.insertImage,
		},
	});

	const insertSelected = focusedDocName
		? async (file: string) => {
				const created = await requests.insertImage(file);
				if (!created) return;
				setSelected(null);
			}
		: null;

	const deleteSelected = (file: string) => {
		wsSend({ type: "delete_asset", filename: file });
		setSelected(null);
	};

	return {
		images: assets.images,
		activeFilter: filters.activeFilter,
		setActiveFilter: filters.setActiveFilter,
		loading: assets.loading,
		selected,
		setSelected,
		search,
		setSearch,
		dragOver,
		setDragOver,
		uploadBtnDrag: upload.uploadBtnDrag,
		setUploadBtnDrag: upload.setUploadBtnDrag,
		uploading: upload.uploading,
		uploadInputRef: upload.uploadInputRef,
		handleUpload: upload.handleUpload,
		openFilePicker: upload.openFilePicker,
		categories: filters.categories,
		filtered: filters.filtered,
		checked,
		clearChecked: () => setChecked(new Set()),
		bulkDelete,
		photoItemFor,
		insertSelected,
		deleteSelected,
		annotationError: requests.error,
	};
}

function PhotosTabView({
	model,
}: {
	model: ReturnType<typeof usePhotosTabModel>;
}) {
	const {
		images,
		activeFilter,
		setActiveFilter,
		loading,
		search,
		setSearch,
		dragOver,
		setDragOver,
		uploadBtnDrag,
		setUploadBtnDrag,
		uploading,
		uploadInputRef,
		handleUpload,
		openFilePicker,
		categories,
		filtered,
		checked,
		clearChecked,
		bulkDelete,
		photoItemFor,
		annotationError,
	} = model;

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden">
			<LibraryToolbar>
				<PhotoToolbar
					model={{
						search,
						setSearch,
						uploadInputRef,
						uploadBtnDrag,
						setUploadBtnDrag,
						uploading,
						handleUpload,
						openFilePicker,
					}}
				/>
			</LibraryToolbar>

			<div
				data-photos-scroll
				className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3"
			>
				{annotationError && (
					<p className="text-xs font-medium text-danger" role="alert">
						{annotationError}
					</p>
				)}

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

				<PhotoContent
					model={{
						loading,
						images,
						filtered,
						dragOver,
						setDragOver,
						openFilePicker,
						handleUpload,
						photoItemFor,
					}}
				/>

				{dragOver && images.length > 0 && (
					<div className="fixed inset-0 bg-accent/10 pointer-events-none z-50 ring-4 ring-accent/40 ring-inset" />
				)}

				{checked.size > 0 && (
					<BulkBar
						count={checked.size}
						onClear={clearChecked}
						onDelete={bulkDelete}
					/>
				)}
			</div>
		</div>
	);
}

interface PhotoToolbarModel {
	search: string;
	setSearch: (value: string) => void;
	uploadInputRef: React.RefObject<HTMLInputElement | null>;
	uploadBtnDrag: boolean;
	setUploadBtnDrag: (dragging: boolean) => void;
	uploading: { total: number; done: number; errors: string[] } | null;
	handleUpload: (files: FileList) => void;
	openFilePicker: () => void;
}

function PhotoToolbar({ model }: { model: PhotoToolbarModel }) {
	const {
		search,
		setSearch,
		uploadInputRef,
		uploadBtnDrag,
		setUploadBtnDrag,
		uploading,
		handleUpload,
		openFilePicker,
	} = model;
	const t = useT();
	return (
		<>
			<LibraryToolbarRow>
				<LibrarySearchField
					value={search}
					onChange={(event) => setSearch(event.target.value)}
					onClear={() => setSearch("")}
					placeholder={t("photo_search_hint")}
				/>
				<LibraryToolbarActions>
					<UploadButton
						inputRef={uploadInputRef}
						dragging={uploadBtnDrag}
						setDragging={setUploadBtnDrag}
						handleUpload={handleUpload}
						openFilePicker={openFilePicker}
					/>
				</LibraryToolbarActions>
			</LibraryToolbarRow>
			{uploading && <UploadProgress uploading={uploading} />}
		</>
	);
}

function UploadButton({
	inputRef,
	dragging,
	setDragging,
	handleUpload,
	openFilePicker,
}: {
	inputRef: React.RefObject<HTMLInputElement | null>;
	dragging: boolean;
	setDragging: (dragging: boolean) => void;
	handleUpload: (files: FileList) => void;
	openFilePicker: () => void;
}) {
	const t = useT();
	return (
		<>
			<input
				ref={inputRef}
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
					if (!dragging) setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={(e) => {
					e.preventDefault();
					setDragging(false);
					if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files);
				}}
				aria-label={t("photo_upload")}
				title={t("photo_upload")}
				className={`w-8 h-8 rounded-lg flex items-center justify-center transition ${
					dragging
						? "bg-accent-soft text-accent ring-2 ring-accent/40"
						: "bg-input text-text-3 hover:text-text-1"
				}`}
			>
				<Upload size={14} />
			</button>
		</>
	);
}

function UploadProgress({
	uploading,
}: {
	uploading: { total: number; done: number; errors: string[] };
}) {
	const t = useT();
	return (
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
	);
}

interface PhotoContentModel {
	loading: boolean;
	images: ImageAsset[];
	filtered: ImageAsset[];
	dragOver: boolean;
	setDragOver: (dragging: boolean) => void;
	openFilePicker: () => void;
	handleUpload: (files: FileList) => void;
	photoItemFor: (img: ImageAsset) => PhotoTileProps;
}

function PhotoContent({ model }: { model: PhotoContentModel }) {
	const {
		loading,
		images,
		filtered,
		dragOver,
		setDragOver,
		openFilePicker,
		handleUpload,
		photoItemFor,
	} = model;
	const t = useT();
	if (loading) {
		return (
			<div className="text-center text-text-3 text-xs py-6">{t("loading")}</div>
		);
	}
	if (images.length === 0) {
		return (
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
		);
	}
	if (filtered.length === 0) {
		return (
			<div className="px-4 py-6 text-center text-base text-text-3">
				{t("photo_no_match")}
			</div>
		);
	}
	return (
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
				<PhotoTile key={img.file} {...photoItemFor(img)} />
			))}
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

interface PhotoTileModel {
	img: ImageAsset;
	checked: boolean;
	menuOpen: boolean;
	mode: RowMode;
}

interface PhotoTileActions {
	click: (e: React.MouseEvent) => void;
	openMenu: () => void;
	closeMenu: () => void;
	changeMode: (mode: RowMode) => void;
	insert: (file: string) => Promise<boolean>;
}

interface PhotoTileProps {
	model: PhotoTileModel;
	actions: PhotoTileActions;
}

function PhotoTile({ model, actions }: PhotoTileProps) {
	const { img, checked, menuOpen, mode } = model;
	const t = useT();
	const menuBtnRef = useRef<HTMLButtonElement>(null);
	const confirming = mode.kind === "confirm-delete";
	const hasDoc = useStore(focusedWorkspaceDocumentName) !== null;
	const [inserting, setInserting] = useState(false);

	const onInsert = async (): Promise<boolean> => {
		const focused = focusedWorkspaceDocumentName(useStore.getState());
		if (!focused || inserting) return false;
		setInserting(true);
		const created = await actions.insert(img.file);
		setInserting(false);
		return created;
	};

	return (
		<div className="relative group/tile">
			<button
				type="button"
				onClick={actions.click}
				className={`aspect-[4/3] w-full rounded-lg relative overflow-hidden transition-transform outline-none ${
					checked
						? "ring-4 ring-accent ring-offset-2 ring-offset-panel"
						: "hover:scale-[1.02]"
				}`}
			>
				<img
					src={`/assets/thumb/${img.file}`}
					alt={img.title || img.file}
					onError={(event) => {
						const fallback = `/assets/${encodeURIComponent(img.file)}`;
						if (event.currentTarget.getAttribute("src") !== fallback) {
							event.currentTarget.src = fallback;
						}
					}}
					className="w-full h-full object-cover"
					loading="lazy"
					decoding="async"
					draggable={false}
				/>

				{checked && (
					<span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-md bg-accent text-white flex items-center justify-center text-2xs font-bold">
						✓
					</span>
				)}

				{(img.width && img.height) || img.orientation ? (
					<span className="absolute bottom-1.5 left-1.5 text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-md bg-black/55 text-white opacity-0 group-hover/tile:opacity-100 transition-opacity backdrop-blur-sm">
						{img.width && img.height
							? `${img.width}×${img.height}`
							: img.orientation}
					</span>
				) : null}

				{!confirming && (
					<div className="absolute inset-x-0 bottom-0 px-2 py-1.5 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover/tile:opacity-100 transition-opacity">
						<span className="text-2xs font-semibold text-white truncate block">
							{img.title || img.file}
						</span>
					</div>
				)}
			</button>

			{confirming && (
				<div className="absolute inset-0 rounded-lg bg-panel/95 backdrop-blur-sm p-1 flex items-center">
					<HoldToDelete
						label={t("photo_delete_hold")}
						onConfirm={() => {
							actions.changeMode({ kind: "idle" });
							wsSend({ type: "delete_asset", filename: img.file });
						}}
						onCancel={() => actions.changeMode({ kind: "idle" })}
					/>
				</div>
			)}

			{!confirming && (
				<div className="absolute top-1.5 left-1.5 flex gap-1 opacity-0 group-hover/tile:opacity-100 transition-opacity">
					{hasDoc && (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								void onInsert();
							}}
							disabled={inserting}
							aria-busy={inserting}
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
							if (menuOpen) actions.closeMenu();
							else actions.openMenu();
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
					onClose={actions.closeMenu}
					onInsert={onInsert}
					onDeleteRequest={() => {
						actions.closeMenu();
						actions.changeMode({ kind: "confirm-delete" });
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
	onInsert: () => Promise<boolean>;
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
			<MenuItem
				icon={<ImagePlus size={13} />}
				disabled={!hasDoc}
				title={!hasDoc ? t("insert_requires_document") : undefined}
				onClick={async () => {
					if (await onInsert()) onClose();
				}}
			>
				{t("insert_in_doc")}
			</MenuItem>
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
	onClick: () => void | Promise<void>;
	danger?: boolean;
	disabled?: boolean;
	title?: string;
}

function MenuItem({
	icon,
	children,
	onClick,
	danger,
	disabled = false,
	title,
}: MenuItemProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			title={title}
			className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left transition ${
				disabled
					? "cursor-not-allowed text-text-3 opacity-55"
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
	error,
}: {
	img: ImageAsset;
	onClose: () => void;
	onInsert: ((file: string) => Promise<void>) | null;
	onDelete: (file: string) => void;
	error: string | null;
}) {
	const t = useT();
	const [confirming, setConfirming] = useState(false);
	const [inserting, setInserting] = useState(false);

	return (
		<div className="flex flex-col gap-3 p-3">
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

			{error && (
				<p className="text-xs font-medium text-danger" role="alert">
					{error}
				</p>
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
					<button
						type="button"
						onClick={async () => {
							if (!onInsert || inserting) return;
							setInserting(true);
							await onInsert(img.file);
							setInserting(false);
						}}
						disabled={!onInsert || inserting}
						aria-busy={inserting}
						title={!onInsert ? t("insert_requires_document") : undefined}
						className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-base font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-input disabled:text-text-3 disabled:hover:brightness-100"
					>
						<ImagePlus size={16} />
						{t("insert_in_doc")}
					</button>
					<button
						type="button"
						onClick={() => setConfirming(true)}
						aria-label={t("doc_delete")}
						title={t("doc_delete")}
						className="py-2.5 px-3 rounded-xl text-base font-semibold border border-danger-border text-danger hover:bg-danger-soft transition flex items-center justify-center"
					>
						<Trash2 size={16} />
					</button>
				</div>
			)}
		</div>
	);
}
