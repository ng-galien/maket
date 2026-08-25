import { type AssetsListItem, normalizeCategoryPath } from "@maket/shared";
import {
	ArrowLeft,
	Copy,
	FolderInput,
	ImagePlus,
	Maximize2,
	MessageCircle,
	MoreVertical,
	Trash2,
	Upload,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/useT";
import type { PendingMessage } from "../store/useStore";
import { useStore } from "../store/useStore";
import { wsSend } from "../store/ws";
import { copyToClipboard } from "../utils";
import {
	type CategoryActionModel,
	CategoryInlineRename,
	CategoryMenu,
	CategoryMenuButton,
} from "./docs/CategoryMenu";
import { CategoryPicker } from "./docs/CategoryPicker";
import {
	categoryRenameDestination,
	useCategoryMove,
} from "./docs/categoryMove";
import {
	buildCategoryTree,
	type CategoryNode,
	flattenCategoryPaths,
} from "./docs/categoryTree";
import { parseQuery } from "./docs/docsQuery";
import { AnchoredMenu, AnchoredMenuItem } from "./shared/AnchoredMenu";
import { HoldToDelete } from "./shared/HoldToDelete";
import {
	LibraryCategoryHeader,
	libraryCategoryGuideOffset,
	libraryCategoryLabelOffset,
} from "./shared/LibraryCategoryHeader";
import { LibrarySearchField } from "./shared/LibrarySearchField";
import {
	LibraryToolbar,
	LibraryToolbarActions,
	LibraryToolbarRow,
} from "./shared/LibraryToolbar";
import { showLibraryScrollActivity } from "./shared/libraryScroll";
import { useModalFocusTrap } from "./shared/useModalFocusTrap";

type ImageAsset = AssetsListItem;
type PhotoCategoryNode = CategoryNode<ImageAsset>;

type RowMode = { kind: "idle" } | { kind: "confirm-delete" };

const PHOTO_DRAG_MIME = "application/x-maket-image";

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
	const images = useStore((state) => state.assets);
	const loading = useStore(
		(state) => state.assetsLoading || !state.assetsLoaded,
	);
	const loadAssets = useStore((state) => state.loadAssets);
	useEffect(() => {
		void loadAssets();
	}, [loadAssets]);
	return { images, loading, refresh: loadAssets };
}

function usePhotoUpload(
	t: ReturnType<typeof useT>,
	refreshAssets: (force?: boolean) => Promise<void>,
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
			await refreshAssets(true);
			const classified = await queueImageClassification(
				selectedFiles,
				state.errors,
				t,
			);
			if (!classified) onAnnotationError();
			setTimeout(() => setUploading(null), state.errors.length ? 3000 : 800);
		},
		[clearAnnotationError, onAnnotationError, refreshAssets, t],
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
	const query = parseQuery(search);
	const searched = images.filter((img) => photoMatchesQuery(img, query));
	const categorized = searched.filter((image) =>
		Boolean(normalizeCategoryPath(image.category)),
	);
	const uncategorized = searched.filter(
		(image) => !normalizeCategoryPath(image.category),
	);
	return {
		categories: buildCategoryTree(
			categorized,
			(image) => image.title || image.file,
		),
		uncategorized,
		searched,
	};
}

function photoMatchesQuery(
	img: ImageAsset,
	query: ReturnType<typeof parseQuery>,
): boolean {
	const category = img.category?.toLowerCase() ?? "";
	if (
		query.categories.length > 0 &&
		!query.categories.some(
			(filter) => category === filter || category.startsWith(`${filter}/`),
		)
	)
		return false;
	if (!query.text) return true;
	const values = [
		img.file,
		img.title,
		img.description,
		img.category,
		...(img.tags ?? []),
	];
	return values.some((value) => value?.toLowerCase().includes(query.text));
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
		assets.refresh,
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
	const [dragOver, setDragOver] = useState(false);
	const filters = usePhotoFilters(assets.images, search);
	const selection = usePhotoSelection(
		filters.searched.map((image) => image.file),
		setSelected,
	);
	const drag = usePhotoCategoryDrag(assets.images);
	const categoryUi = usePhotoCategoryUi();
	const categoryMove = useCategoryMove(
		flattenCategoryPaths(
			buildCategoryTree(
				assets.images.filter((image) =>
					Boolean(normalizeCategoryPath(image.category)),
				),
				(image) => image.title || image.file,
			),
		),
		(target, category) => {
			if (target.kind !== "asset") return;
			wsSend({
				type: "update_asset_category",
				filename: target.name,
				category,
			});
		},
		sendAssetCategoryMove,
	);

	const photoItemFor = (img: ImageAsset): PhotoTileProps => ({
		model: {
			img,
			checked: selection.checked.has(img.file),
			dragging: drag.draggingAsset === img.file,
			menuOpen: menuFor === img.file,
			mode:
				modeFor?.file === img.file
					? modeFor.mode
					: ({ kind: "idle" } as RowMode),
		},
		actions: {
			click: (event) => selection.click(img, event),
			openMenu: () => setMenuFor(img.file),
			closeMenu: () => setMenuFor(null),
			changeMode: (mode) =>
				setModeFor(mode.kind === "idle" ? null : { file: img.file, mode }),
			insert: requests.insertImage,
			moveCategory: () =>
				categoryMove.requestItemMove({
					kind: "asset",
					name: img.file,
					category: img.category ?? "",
				}),
			dragStart: (event) => drag.start(img.file, event),
			dragEnd: drag.end,
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
		uncategorized: filters.uncategorized,
		...categoryUi,
		requestCategoryMove: categoryMove.requestCategoryMove,
		dragOverCategory: drag.dragOverCategory,
		handleCategoryDragOver: drag.over,
		handleCategoryDragLeave: drag.leave,
		handleCategoryDrop: drag.drop,
		renameCategory: (source: string, nextName: string) => {
			const destination = categoryRenameDestination(source, nextName);
			if (destination) sendAssetCategoryMove(source, destination);
		},
		movePicker: categoryMove.model,
		checked: selection.checked,
		clearChecked: selection.clear,
		bulkDelete: selection.bulkDelete,
		photoItemFor,
		insertSelected,
		deleteSelected,
		annotationError: requests.error,
	};
}

function usePhotoSelection(
	flatOrder: string[],
	select: (image: ImageAsset | null) => void,
) {
	const [checked, setChecked] = useState<Set<string>>(new Set());
	const [lastClicked, setLastClicked] = useState<string | null>(null);
	useEffect(() => {
		if (checked.size === 0) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setChecked(new Set());
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [checked.size]);
	const click = (image: ImageAsset, event: React.MouseEvent) => {
		if (event.metaKey || event.ctrlKey) {
			event.preventDefault();
			setChecked((current) => toggleSelection(current, image.file));
			setLastClicked(image.file);
			return;
		}
		if (event.shiftKey && lastClicked) {
			event.preventDefault();
			setChecked((current) =>
				selectPhotoRange(current, flatOrder, lastClicked, image.file),
			);
			return;
		}
		if (checked.size > 0) setChecked(new Set());
		setLastClicked(image.file);
		select(image);
	};
	return {
		checked,
		click,
		clear: () => setChecked(new Set()),
		bulkDelete: () => {
			for (const file of checked) {
				wsSend({ type: "delete_asset", filename: file });
			}
			setChecked(new Set());
		},
	};
}

function toggleSelection(current: Set<string>, file: string): Set<string> {
	const next = new Set(current);
	if (next.has(file)) next.delete(file);
	else next.add(file);
	return next;
}

function selectPhotoRange(
	current: Set<string>,
	order: string[],
	fromFile: string,
	toFile: string,
): Set<string> {
	const from = order.indexOf(fromFile);
	const to = order.indexOf(toFile);
	if (from < 0 || to < 0) return current;
	const next = new Set(current);
	const [lo, hi] = from < to ? [from, to] : [to, from];
	for (let index = lo; index <= hi; index += 1) {
		const file = order[index];
		if (file) next.add(file);
	}
	return next;
}

function usePhotoCategoryUi() {
	const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
		new Set(),
	);
	const [categoryMenuFor, setCategoryMenuFor] = useState<string | null>(null);
	const [categoryRenameFor, setCategoryRenameFor] = useState<string | null>(
		null,
	);
	return {
		collapsedCategories,
		toggleCategory: (category: string) =>
			setCollapsedCategories((current) => toggleSelection(current, category)),
		categoryMenuFor,
		setCategoryMenuFor,
		categoryRenameFor,
		setCategoryRenameFor,
	};
}

function usePhotoCategoryDrag(images: ImageAsset[]) {
	const [draggingAsset, setDraggingAsset] = useState<string | null>(null);
	const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);
	return {
		draggingAsset,
		dragOverCategory,
		start: (file: string, event: React.DragEvent) => {
			event.dataTransfer.effectAllowed = "move";
			event.dataTransfer.setData(PHOTO_DRAG_MIME, file);
			setPhotoDragPreview(event);
			setDraggingAsset(file);
		},
		end: () => {
			setDraggingAsset(null);
			setDragOverCategory(null);
		},
		over: (event: React.DragEvent, category: string) => {
			if (!event.dataTransfer.types.includes(PHOTO_DRAG_MIME)) return;
			event.preventDefault();
			event.stopPropagation();
			event.dataTransfer.dropEffect = "move";
			setDragOverCategory(category);
		},
		leave: (event: React.DragEvent, category: string) => {
			const related = event.relatedTarget as Node | null;
			if (!related || !event.currentTarget.contains(related)) {
				setDragOverCategory((current) =>
					current === category ? null : current,
				);
			}
		},
		drop: (event: React.DragEvent, category: string) => {
			if (!event.dataTransfer.types.includes(PHOTO_DRAG_MIME)) return;
			event.preventDefault();
			event.stopPropagation();
			const filename = event.dataTransfer.getData(PHOTO_DRAG_MIME);
			setDragOverCategory(null);
			setDraggingAsset(null);
			const source = images.find((image) => image.file === filename);
			if (!source || normalizeCategoryPath(source.category) === category)
				return;
			wsSend({ type: "update_asset_category", filename, category });
		},
	};
}

function sendAssetCategoryMove(source: string, destination: string) {
	if (source === destination) return;
	wsSend({ type: "move_asset_category", source, destination });
}

function setPhotoDragPreview(event: React.DragEvent): void {
	if (!event.dataTransfer.setDragImage) return;
	const preview = document.createElement("div");
	preview.dataset.photoDragPreview = "";
	Object.assign(preview.style, {
		position: "fixed",
		left: "-100px",
		top: "-100px",
		display: "grid",
		placeItems: "center",
		width: "34px",
		height: "34px",
		border: "1px solid var(--color-accent-border)",
		borderRadius: "7px",
		background: "var(--color-panel)",
		boxShadow: "0 4px 12px rgba(0, 0, 0, 0.18)",
	});
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("width", "18");
	svg.setAttribute("height", "18");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("fill", "none");
	svg.setAttribute("stroke", "var(--color-accent)");
	svg.setAttribute("stroke-width", "2");
	svg.setAttribute("stroke-linecap", "round");
	svg.setAttribute("stroke-linejoin", "round");
	const frame = document.createElementNS("http://www.w3.org/2000/svg", "rect");
	frame.setAttribute("width", "18");
	frame.setAttribute("height", "18");
	frame.setAttribute("x", "3");
	frame.setAttribute("y", "3");
	frame.setAttribute("rx", "2");
	const sun = document.createElementNS("http://www.w3.org/2000/svg", "circle");
	sun.setAttribute("cx", "9");
	sun.setAttribute("cy", "9");
	sun.setAttribute("r", "2");
	const landscape = document.createElementNS(
		"http://www.w3.org/2000/svg",
		"path",
	);
	landscape.setAttribute("d", "m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21");
	svg.append(frame, sun, landscape);
	preview.appendChild(svg);
	document.body.appendChild(preview);
	event.dataTransfer.setDragImage(preview, 17, 17);
	requestAnimationFrame(() => preview.remove());
}

function PhotosTabView({
	model,
}: {
	model: ReturnType<typeof usePhotosTabModel>;
}) {
	const {
		images,
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
		uncategorized,
		collapsedCategories,
		toggleCategory,
		categoryMenuFor,
		setCategoryMenuFor,
		categoryRenameFor,
		setCategoryRenameFor,
		requestCategoryMove,
		renameCategory,
		dragOverCategory,
		handleCategoryDragOver,
		handleCategoryDragLeave,
		handleCategoryDrop,
		movePicker,
		checked,
		clearChecked,
		bulkDelete,
		photoItemFor,
		annotationError,
	} = model;

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden">
			<CategoryPicker model={movePicker} />
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
				onScroll={showLibraryScrollActivity}
				className="library-scroll-area flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3"
			>
				{annotationError && (
					<p className="text-xs font-medium text-danger" role="alert">
						{annotationError}
					</p>
				)}

				<PhotoContent
					model={{
						loading,
						images,
						categories,
						uncategorized,
						collapsedCategories,
						toggleCategory,
						categoryMenuFor,
						setCategoryMenuFor,
						categoryRenameFor,
						setCategoryRenameFor,
						requestCategoryMove,
						renameCategory,
						dragOverCategory,
						handleCategoryDragOver,
						handleCategoryDragLeave,
						handleCategoryDrop,
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
				className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
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
		<div className="mx-1 rounded-md border border-accent-border bg-accent-soft px-3 py-2">
			<div className="h-1.5 overflow-hidden rounded-full bg-accent/15">
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
	categories: PhotoCategoryNode[];
	uncategorized: ImageAsset[];
	collapsedCategories: Set<string>;
	toggleCategory: (category: string) => void;
	categoryMenuFor: string | null;
	setCategoryMenuFor: React.Dispatch<React.SetStateAction<string | null>>;
	categoryRenameFor: string | null;
	setCategoryRenameFor: React.Dispatch<React.SetStateAction<string | null>>;
	requestCategoryMove: (path: string) => void;
	renameCategory: (path: string, name: string) => void;
	dragOverCategory: string | null;
	handleCategoryDragOver: (event: React.DragEvent, category: string) => void;
	handleCategoryDragLeave: (event: React.DragEvent, category: string) => void;
	handleCategoryDrop: (event: React.DragEvent, category: string) => void;
	dragOver: boolean;
	setDragOver: (dragging: boolean) => void;
	openFilePicker: () => void;
	handleUpload: (files: FileList) => void;
	photoItemFor: (img: ImageAsset) => PhotoTileProps;
}

type PhotoCategoryControls = Pick<
	PhotoContentModel,
	| "collapsedCategories"
	| "toggleCategory"
	| "categoryMenuFor"
	| "setCategoryMenuFor"
	| "categoryRenameFor"
	| "setCategoryRenameFor"
	| "requestCategoryMove"
	| "renameCategory"
	| "dragOverCategory"
	| "handleCategoryDragOver"
	| "handleCategoryDragLeave"
	| "handleCategoryDrop"
>;

function PhotoContent({ model }: { model: PhotoContentModel }) {
	const {
		loading,
		images,
		categories,
		uncategorized,
		collapsedCategories,
		toggleCategory,
		categoryMenuFor,
		setCategoryMenuFor,
		categoryRenameFor,
		setCategoryRenameFor,
		requestCategoryMove,
		renameCategory,
		dragOverCategory,
		handleCategoryDragOver,
		handleCategoryDragLeave,
		handleCategoryDrop,
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
	if (categories.length === 0 && uncategorized.length === 0) {
		return (
			<div className="px-4 py-6 text-center text-base text-text-3">
				{t("photo_no_match")}
			</div>
		);
	}
	const categoryControls: PhotoCategoryControls = {
		collapsedCategories,
		toggleCategory,
		categoryMenuFor,
		setCategoryMenuFor,
		categoryRenameFor,
		setCategoryRenameFor,
		requestCategoryMove,
		renameCategory,
		dragOverCategory,
		handleCategoryDragOver,
		handleCategoryDragLeave,
		handleCategoryDrop,
	};
	return (
		<div
			className="flex flex-col gap-3"
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
			{categories.map((category) => (
				<PhotoCategory
					key={category.path}
					node={category}
					depth={0}
					controls={categoryControls}
					photoItemFor={photoItemFor}
				/>
			))}
			{uncategorized.length > 0 && (
				<PhotoUncategorizedCategory
					images={uncategorized}
					collapsed={collapsedCategories.has("")}
					onToggle={() => toggleCategory("")}
					photoItemFor={photoItemFor}
				/>
			)}
		</div>
	);
}

function PhotoCategory({
	node,
	depth,
	controls,
	photoItemFor,
}: {
	node: PhotoCategoryNode;
	depth: number;
	controls: PhotoCategoryControls;
	photoItemFor: (image: ImageAsset) => PhotoTileProps;
}) {
	const t = useT();
	const menuButtonRef = useRef<HTMLButtonElement>(null);
	const collapsed = controls.collapsedCategories.has(node.path);
	const actionModel: CategoryActionModel = {
		name: node.name,
		path: node.path,
		depth,
		menuOpen: controls.categoryMenuFor === node.path,
		openMenu: () => controls.setCategoryMenuFor(node.path),
		closeMenu: () => controls.setCategoryMenuFor(null),
		startMove: () => {
			controls.setCategoryMenuFor(null);
			controls.requestCategoryMove(node.path);
		},
		startRename: () => {
			controls.setCategoryMenuFor(null);
			controls.setCategoryRenameFor(node.path);
		},
		cancelRename: () => controls.setCategoryRenameFor(null),
		rename: (name) => {
			controls.setCategoryRenameFor(null);
			controls.renameCategory(node.path, name);
		},
	};
	return (
		<section className="min-w-0" data-photo-category={node.path}>
			{controls.categoryRenameFor === node.path ? (
				<CategoryInlineRename model={actionModel} />
			) : (
				<LibraryCategoryHeader
					model={{
						name: node.name,
						path: node.path,
						depth,
						total: node.total,
						collapsed,
						dropActive: controls.dragOverCategory === node.path,
						toggle: () => controls.toggleCategory(node.path),
						dragOver: (event) =>
							controls.handleCategoryDragOver(event, node.path),
						dragLeave: (event) =>
							controls.handleCategoryDragLeave(event, node.path),
						drop: (event) => controls.handleCategoryDrop(event, node.path),
					}}
					toggleLabel={t("photo_category_toggle", { category: node.path })}
					countTitle={t("category_image_total", { total: node.total })}
					actions={
						<>
							<CategoryMenuButton
								model={actionModel}
								anchorRef={menuButtonRef}
							/>
							<CategoryMenu model={actionModel} anchorRef={menuButtonRef} />
						</>
					}
				/>
			)}
			{!collapsed && (
				<>
					{node.docs.length > 0 && (
						<div
							className="mt-1.5 grid grid-cols-2 gap-2 pr-1"
							style={{
								marginLeft: `${libraryCategoryLabelOffset(depth) - 8}px`,
							}}
						>
							{node.docs.map((image) => (
								<PhotoTile key={image.file} {...photoItemFor(image)} />
							))}
						</div>
					)}
					{node.children.length > 0 && (
						<div className="relative">
							<div
								aria-hidden
								className="absolute bottom-2 top-0 w-px bg-border"
								style={{ left: `${libraryCategoryGuideOffset(depth)}px` }}
							/>
							{node.children.map((child) => (
								<PhotoCategory
									key={child.path}
									node={child}
									depth={depth + 1}
									controls={controls}
									photoItemFor={photoItemFor}
								/>
							))}
						</div>
					)}
				</>
			)}
		</section>
	);
}

function PhotoUncategorizedCategory({
	images,
	collapsed,
	onToggle,
	photoItemFor,
}: {
	images: ImageAsset[];
	collapsed: boolean;
	onToggle: () => void;
	photoItemFor: (image: ImageAsset) => PhotoTileProps;
}) {
	const t = useT();
	const label = t("photo_uncategorized");
	return (
		<section className="min-w-0" data-photo-category="">
			<LibraryCategoryHeader
				model={{
					name: label,
					path: label,
					depth: 0,
					total: images.length,
					collapsed,
					toggle: onToggle,
				}}
				toggleLabel={t("photo_category_toggle", { category: label })}
				countTitle={t("category_image_total", { total: images.length })}
			/>
			{!collapsed && (
				<div className="mt-1.5 grid grid-cols-2 gap-2 pl-1 pr-1">
					{images.map((image) => (
						<PhotoTile key={image.file} {...photoItemFor(image)} />
					))}
				</div>
			)}
		</section>
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
			className={`rounded-md border border-dashed px-6 py-10 text-center transition-colors ${
				dragOver
					? "border-accent bg-accent-soft text-accent"
					: "border-border bg-input/40 text-text-3 hover:border-accent-border hover:bg-accent-soft hover:text-accent"
			}`}
		>
			<div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md border border-border bg-panel">
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
	dragging: boolean;
	menuOpen: boolean;
	mode: RowMode;
}

interface PhotoTileActions {
	click: (e: React.MouseEvent) => void;
	openMenu: () => void;
	closeMenu: () => void;
	changeMode: (mode: RowMode) => void;
	insert: (file: string) => Promise<boolean>;
	moveCategory: () => void;
	dragStart: (event: React.DragEvent) => void;
	dragEnd: () => void;
}

interface PhotoTileProps {
	model: PhotoTileModel;
	actions: PhotoTileActions;
}

function PhotoTile({ model, actions }: PhotoTileProps) {
	const { img, checked, dragging, menuOpen, mode } = model;
	const t = useT();
	const menuBtnRef = useRef<HTMLButtonElement>(null);
	const confirming = mode.kind === "confirm-delete";
	const hasDoc = useStore(focusedWorkspaceDocumentName) !== null;
	const [inserting, setInserting] = useState(false);
	const [fullscreen, setFullscreen] = useState(false);

	const onInsert = async (): Promise<boolean> => {
		const focused = focusedWorkspaceDocumentName(useStore.getState());
		if (!focused || inserting) return false;
		setInserting(true);
		const created = await actions.insert(img.file);
		setInserting(false);
		return created;
	};

	return (
		<div
			className={`relative group/tile ${dragging ? "opacity-40" : ""}`}
			draggable={mode.kind === "idle"}
			onDragStart={actions.dragStart}
			onDragEnd={actions.dragEnd}
			data-photo-file={img.file}
		>
			<PhotoTileThumbnail
				img={img}
				checked={checked}
				confirming={confirming}
				onClick={actions.click}
			/>

			{confirming && (
				<div className="absolute inset-0 flex items-center rounded-md bg-panel/95 p-1 backdrop-blur-sm">
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
				<PhotoTileControls
					hasDoc={hasDoc}
					inserting={inserting}
					menuOpen={menuOpen}
					menuButtonRef={menuBtnRef}
					onFullscreen={() => setFullscreen(true)}
					onInsert={onInsert}
					onOpenMenu={actions.openMenu}
					onCloseMenu={actions.closeMenu}
				/>
			)}

			{menuOpen && (
				<PhotoMenu
					img={img}
					hasDoc={hasDoc}
					anchorRef={menuBtnRef}
					onClose={actions.closeMenu}
					onInsert={onInsert}
					onMoveRequest={() => {
						actions.closeMenu();
						actions.moveCategory();
					}}
					onDeleteRequest={() => {
						actions.closeMenu();
						actions.changeMode({ kind: "confirm-delete" });
					}}
				/>
			)}
			{fullscreen && (
				<PhotoLightbox img={img} onClose={() => setFullscreen(false)} />
			)}
		</div>
	);
}

function PhotoTileThumbnail({
	img,
	checked,
	confirming,
	onClick,
}: {
	img: ImageAsset;
	checked: boolean;
	confirming: boolean;
	onClick: (event: React.MouseEvent) => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`relative aspect-[4/3] w-full overflow-hidden rounded-md outline-none transition-shadow ${
				checked
					? "ring-2 ring-accent ring-offset-1 ring-offset-panel"
					: "hover:ring-2 hover:ring-accent/30"
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
				className="h-full w-full object-cover"
				loading="lazy"
				decoding="async"
				draggable={false}
			/>
			{checked && (
				<span className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-md bg-accent text-2xs font-bold text-accent-contrast">
					✓
				</span>
			)}
			{(img.width && img.height) || img.orientation ? (
				<span
					className={`absolute top-1.5 ${checked ? "left-8" : "left-1.5"} rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white opacity-0 backdrop-blur-sm transition-opacity group-hover/tile:opacity-100`}
				>
					{img.width && img.height
						? `${img.width}×${img.height}`
						: img.orientation}
				</span>
			) : null}
			{!confirming && (
				<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5 opacity-0 transition-opacity group-hover/tile:opacity-100">
					<span className="block truncate text-2xs font-semibold text-white">
						{img.title || img.file}
					</span>
				</div>
			)}
		</button>
	);
}

interface PhotoTileControlsProps {
	hasDoc: boolean;
	inserting: boolean;
	menuOpen: boolean;
	menuButtonRef: React.RefObject<HTMLButtonElement | null>;
	onFullscreen: () => void;
	onInsert: () => Promise<boolean>;
	onOpenMenu: () => void;
	onCloseMenu: () => void;
}

function PhotoTileControls(props: PhotoTileControlsProps) {
	const {
		hasDoc,
		inserting,
		menuOpen,
		menuButtonRef,
		onFullscreen,
		onInsert,
		onOpenMenu,
		onCloseMenu,
	} = props;
	const t = useT();
	return (
		<div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover/tile:opacity-100 focus-within:opacity-100">
			<button
				type="button"
				onClick={(event) => {
					event.stopPropagation();
					onFullscreen();
				}}
				aria-label={t("photo_fullscreen")}
				title={t("photo_fullscreen")}
				className="flex h-7 w-7 items-center justify-center rounded-md bg-black/55 text-white backdrop-blur-sm transition hover:bg-black/70"
			>
				<Maximize2 size={13} />
			</button>
			{hasDoc && (
				<button
					type="button"
					onClick={(event) => {
						event.stopPropagation();
						void onInsert();
					}}
					disabled={inserting}
					aria-busy={inserting}
					aria-label={t("photo_ask_agent_add")}
					title={t("photo_ask_agent_add")}
					className="flex h-7 w-7 items-center justify-center rounded-md bg-black/55 text-white backdrop-blur-sm transition hover:bg-accent hover:text-accent-contrast"
				>
					<MessageCircle size={13} />
				</button>
			)}
			<button
				ref={menuButtonRef}
				type="button"
				aria-label={t("photo_menu")}
				aria-haspopup="menu"
				aria-expanded={menuOpen}
				onClick={(event) => {
					event.stopPropagation();
					if (menuOpen) onCloseMenu();
					else onOpenMenu();
				}}
				className={`flex h-7 w-7 items-center justify-center rounded-md text-white backdrop-blur-sm transition ${
					menuOpen ? "bg-black/70" : "bg-black/55 hover:bg-black/70"
				}`}
			>
				<MoreVertical size={13} />
			</button>
		</div>
	);
}

interface PhotoMenuProps {
	img: ImageAsset;
	hasDoc: boolean;
	anchorRef: React.RefObject<HTMLElement | null>;
	onClose: () => void;
	onInsert: () => Promise<boolean>;
	onMoveRequest: () => void;
	onDeleteRequest: () => void;
}

function PhotoMenu({
	img,
	hasDoc,
	anchorRef,
	onClose,
	onInsert,
	onMoveRequest,
	onDeleteRequest,
}: PhotoMenuProps) {
	const t = useT();
	const handleCopy = async () => {
		await copyToClipboard(img.file);
		onClose();
	};

	return (
		<AnchoredMenu
			anchorRef={anchorRef}
			onClose={onClose}
			align="start"
			className="w-[200px]"
			ariaLabel={t("photo_menu")}
		>
			<AnchoredMenuItem
				icon={<MessageCircle size={13} />}
				disabled={!hasDoc}
				title={!hasDoc ? t("photo_ask_agent_requires_document") : undefined}
				onClick={async () => {
					if (await onInsert()) onClose();
				}}
			>
				{t("photo_ask_agent_add")}
			</AnchoredMenuItem>
			<AnchoredMenuItem icon={<Copy size={13} />} onClick={handleCopy}>
				{t("photo_copy_filename")}
			</AnchoredMenuItem>
			<AnchoredMenuItem
				icon={<FolderInput size={13} />}
				onClick={onMoveRequest}
			>
				{t("doc_move_category")}
			</AnchoredMenuItem>
			<div aria-hidden="true" className="my-1 h-px bg-border" />
			<AnchoredMenuItem
				icon={<Trash2 size={13} />}
				onClick={onDeleteRequest}
				danger
			>
				{t("doc_delete")}
			</AnchoredMenuItem>
		</AnchoredMenu>
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
		<div className="sticky bottom-2 z-40 mx-1 mt-2 flex items-center gap-1.5 rounded-md border border-border bg-panel p-2 shadow-md">
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
				className="flex h-7 w-7 items-center justify-center rounded-md text-text-3 transition hover:bg-input"
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
	const [fullscreen, setFullscreen] = useState(false);

	return (
		<div className="flex flex-col gap-3 p-3">
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={onClose}
					className="rounded-md p-1.5 text-text-3 transition hover:bg-input hover:text-text-1"
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

			<div className="relative overflow-hidden rounded-md border border-border bg-input">
				<img
					src={`/assets/${img.file}`}
					alt={img.title || img.file}
					className="w-full max-h-[250px] object-contain"
				/>
				<button
					type="button"
					onClick={() => setFullscreen(true)}
					aria-label={t("photo_fullscreen")}
					title={t("photo_fullscreen")}
					className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md border border-white/20 bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75"
				>
					<Maximize2 size={15} />
				</button>
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
						title={
							!onInsert ? t("photo_ask_agent_requires_document") : undefined
						}
						className="flex flex-1 items-center justify-center gap-2 rounded-md bg-accent py-2.5 text-base font-semibold text-accent-contrast transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-input disabled:text-text-3 disabled:hover:brightness-100"
					>
						<MessageCircle size={16} />
						{t("photo_ask_agent_add")}
					</button>
					<button
						type="button"
						onClick={() => setConfirming(true)}
						aria-label={t("doc_delete")}
						title={t("doc_delete")}
						className="flex items-center justify-center rounded-md border border-danger-border px-3 py-2.5 text-base font-semibold text-danger transition hover:bg-danger-soft"
					>
						<Trash2 size={16} />
					</button>
				</div>
			)}
			{fullscreen && (
				<PhotoLightbox img={img} onClose={() => setFullscreen(false)} />
			)}
		</div>
	);
}

function PhotoLightbox({
	img,
	onClose,
}: {
	img: ImageAsset;
	onClose: () => void;
}) {
	const t = useT();
	const dialogRef = useRef<HTMLDivElement>(null);
	const closeRef = useRef<HTMLButtonElement>(null);
	useModalFocusTrap({
		open: true,
		containerRef: dialogRef,
		initialFocusRef: closeRef,
		onEscape: onClose,
	});
	return createPortal(
		<div
			ref={dialogRef}
			role="dialog"
			aria-modal="true"
			aria-label={img.title || img.file}
			className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/92 p-6"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<img
				src={`/assets/${img.file}`}
				alt={img.title || img.file}
				className="max-h-full max-w-full object-contain"
			/>
			<button
				ref={closeRef}
				type="button"
				onClick={onClose}
				aria-label={t("photo_fullscreen_close")}
				title={t("photo_fullscreen_close")}
				className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-md border border-white/20 bg-black/60 text-white transition-colors hover:bg-black/80"
			>
				<X size={18} />
			</button>
			<div className="absolute bottom-4 left-1/2 max-w-[min(80vw,720px)] -translate-x-1/2 truncate rounded-md bg-black/60 px-3 py-1.5 text-sm font-medium text-white backdrop-blur-sm">
				{img.title || img.file}
			</div>
		</div>,
		document.body,
	);
}
