import {
	ArrowLeft,
	Camera,
	ChevronRight,
	Folder,
	ImagePlus,
	Images,
	Search,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import { browserPath } from "../lib/browserBasePath";
import {
	beginMobileNavigation,
	beginMobileReturn,
	useMobileHistoryState,
} from "../lib/mobileHistory";
import { useStore } from "../store/useStore";

function imagePath(file: string, thumbnail = false) {
	return browserPath(
		`/assets/${thumbnail ? "thumb/" : ""}${file.split("/").map(encodeURIComponent).join("/")}`,
	);
}

/** A library-only photo flow. The OS owns file/camera choice; only the explicit
 * confirmation uploads. No document or camera permission is modified. */
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
function useMobilePhotos(active: boolean) {
	const t = useT();
	const assets = useStore((s) => s.assets);
	const loading = useStore((s) => s.assetsLoading);
	const load = useStore((s) => s.loadAssets);
	const [category, setCategory] = useMobileHistoryState("photos:category", "");
	const [query, setQuery] = useMobileHistoryState(
		"photos:query",
		"",
		"context",
	);
	const [selected, setSelected] = useMobileHistoryState<string | null>(
		"photos:selected",
		null,
	);
	const [adding, setAdding] = useMobileHistoryState("photos:adding", false);
	const [draft, setDraft] = useMobileHistoryState<File | null>(
		"photos:draft",
		null,
	);
	const [preview, setPreview] = useState("");
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState("");
	const [status, setStatus] = useState("");
	const existing = useRef<HTMLInputElement>(null);
	const camera = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (active) void load();
	}, [active, load]);
	useEffect(() => {
		if (!draft) {
			setPreview("");
			return;
		}
		const url = URL.createObjectURL(draft);
		setPreview(url);
		return () => URL.revokeObjectURL(url);
	}, [draft]);
	const choose = (file: File | undefined) => {
		if (!file) return;
		setError("");
		setStatus("");
		if (!file.type.startsWith("image/")) {
			setError(t("mobile_image_invalid"));
			return;
		}
		setDraft(file);
		setAdding(false);
	};
	const openPicker = (input: HTMLInputElement | null) => {
		beginMobileNavigation();
		setAdding(false);
		input?.click();
	};
	const upload = async () => {
		if (!draft || uploading) return;
		setUploading(true);
		setError("");
		try {
			const dot = draft.name.lastIndexOf(".");
			const stem = dot > 0 ? draft.name.slice(0, dot) : draft.name;
			const extension = dot > 0 ? draft.name.slice(dot) : "";
			const file = new File(
				[draft],
				`${stem}-${crypto.randomUUID().slice(0, 8)}${extension}`,
				{ type: draft.type },
			);
			const form = new FormData();
			form.append("file", file);
			const response = await fetch(browserPath("/api/upload"), {
				method: "POST",
				body: form,
			});
			const result = await response.json();
			if (!response.ok || result.ok !== true)
				throw new Error(result.error ?? `HTTP ${response.status}`);
			beginMobileNavigation();
			setDraft(null);
			setSelected(result.file);
			setStatus(t("mobile_image_added"));
			await load(true);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setUploading(false);
		}
	};
	const search = query.trim().toLocaleLowerCase();
	const prefix = category ? `${category}/` : "";
	const folders = new Set<string>();
	const images = assets.filter((image) => {
		const path = image.category ?? "";
		if (search)
			return `${image.title ?? ""} ${image.file} ${path}`
				.toLocaleLowerCase()
				.includes(search);
		if (path === category) return true;
		if (path.startsWith(prefix)) {
			const child = path.slice(prefix.length).split("/")[0];
			if (child) folders.add(child);
		}
		return false;
	});
	const selectedImage = assets.find((image) => image.file === selected);
	const detail = Boolean(selected || draft || adding);
	const back = () => {
		if (uploading) return;
		beginMobileReturn();
		if (draft) setDraft(null);
		else if (adding) setAdding(false);
		else if (selected) {
			setSelected(null);
			setStatus("");
		} else setCategory(category.split("/").slice(0, -1).join("/"));
		setError("");
	};
	return {
		t,
		loading,
		category,
		setCategory,
		query,
		setQuery,
		selected,
		setSelected,
		adding,
		setAdding,
		draft,
		setDraft,
		preview,
		uploading,
		error,
		setError,
		status,
		existing,
		camera,
		choose,
		openPicker,
		upload,
		folders,
		images,
		prefix,
		selectedImage,
		detail,
		back,
	};
}

// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
export function MobilePhotosLibrary({ active }: { active: boolean }) {
	const {
		t,
		loading,
		category,
		setCategory,
		query,
		setQuery,
		selected,
		setSelected,
		adding,
		setAdding,
		draft,
		setDraft,
		preview,
		uploading,
		error,
		setError,
		status,
		existing,
		camera,
		choose,
		openPicker,
		upload,
		folders,
		images,
		prefix,
		selectedImage,
		detail,
		back,
	} = useMobilePhotos(active);
	return (
		<div
			data-mobile-photos
			className={`${active ? "flex" : "hidden"} min-h-0 flex-1 flex-col`}
		>
			<input
				ref={existing}
				data-mobile-existing-photo
				type="file"
				accept="image/*"
				className="hidden"
				onChange={(event) => {
					choose(event.target.files?.[0]);
					event.target.value = "";
				}}
			/>
			<input
				ref={camera}
				data-mobile-camera-photo
				type="file"
				accept="image/*"
				capture="environment"
				className="hidden"
				onChange={(event) => {
					choose(event.target.files?.[0]);
					event.target.value = "";
				}}
			/>
			<div className="flex min-h-16 shrink-0 items-center gap-3 border-b border-border px-3">
				{(detail || category) && (
					<button
						type="button"
						aria-label={t("mobile_explorer_up")}
						onClick={back}
						disabled={uploading}
						className="grid size-12 shrink-0 place-items-center"
					>
						<ArrowLeft size={24} />
					</button>
				)}
				<h1 className="min-w-0 flex-1 break-words text-[16px] font-semibold">
					{draft
						? t("mobile_image_preview")
						: adding
							? t("mobile_add_image")
							: selected
								? (selectedImage?.title ?? selected)
								: t("photos") + (category ? ` / ${category}` : "")}
				</h1>
				{!detail && (
					<button
						type="button"
						aria-label={t("mobile_add_image")}
						onClick={() => {
							setAdding(true);
							setError("");
						}}
						className="grid size-12 shrink-0 place-items-center rounded-xl border border-border"
					>
						<ImagePlus size={24} />
					</button>
				)}
				<button
					type="button"
					aria-label={t("close_active_panel")}
					disabled={uploading}
					onClick={() => useStore.getState().closeLastPanel()}
					className="grid size-12 shrink-0 place-items-center"
				>
					<X size={22} />
				</button>
			</div>
			{error && (
				<p role="alert" className="shrink-0 px-4 py-3 text-[16px] text-danger">
					{error}
				</p>
			)}
			{status && (
				<p role="status" className="shrink-0 px-4 py-3 text-[16px] text-accent">
					{status}
				</p>
			)}
			{adding && (
				<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
					<PhotoChoice
						icon={<Images size={28} />}
						label={t("mobile_existing_photos")}
						onClick={() => openPicker(existing.current)}
					/>
					<PhotoChoice
						icon={<Camera size={28} />}
						label={t("mobile_take_photo")}
						onClick={() => openPicker(camera.current)}
					/>
					<p className="text-[14px] leading-relaxed text-text-3">
						{t("mobile_photo_native")}
					</p>
				</div>
			)}
			{draft && (
				<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
					<img
						src={preview}
						alt={t("mobile_image_preview")}
						className="min-h-0 flex-1 object-contain"
					/>
					<p className="break-words text-[14px] text-text-3">{draft.name}</p>
					<button
						type="button"
						disabled={uploading}
						onClick={() => void upload()}
						className="min-h-12 shrink-0 rounded-xl bg-accent px-4 py-3 text-[16px] font-semibold text-accent-contrast"
					>
						{t(uploading ? "mobile_image_uploading" : "mobile_image_confirm")}
					</button>
					<button
						type="button"
						disabled={uploading}
						onClick={() => setDraft(null)}
						className="min-h-12 shrink-0 rounded-xl border border-border px-4 py-3 text-[16px]"
					>
						{t("cancel")}
					</button>
				</div>
			)}
			{selected && !draft && (
				<img
					data-mobile-photo-detail
					src={imagePath(selected)}
					alt={selectedImage?.title ?? selected}
					className="min-h-0 flex-1 object-contain p-3"
				/>
			)}
			<PhotoList
				{...{
					detail,
					folders,
					images,
					prefix,
					setCategory,
					setQuery,
					setSelected,
					loading,
					t,
				}}
			/>
			{!detail && (
				<div className="shrink-0 border-t border-border p-3">
					<label className="flex min-h-12 items-center gap-3 rounded-xl border border-border bg-input px-3">
						<Search size={22} />
						<input
							type="search"
							aria-label={t("mobile_explorer_search")}
							placeholder={t("mobile_explorer_search")}
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							className="min-w-0 flex-1 bg-transparent py-3 text-[16px] outline-none"
						/>
					</label>
				</div>
			)}
		</div>
	);
}

function PhotoChoice({
	icon,
	label,
	onClick,
}: {
	icon: React.ReactNode;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex min-h-20 items-center gap-4 rounded-xl border border-border bg-input px-5 py-4 text-left text-[16px] font-semibold"
		>
			{icon}
			{label}
		</button>
	);
}

function PhotoList(
	props: Pick<
		ReturnType<typeof useMobilePhotos>,
		| "detail"
		| "folders"
		| "images"
		| "prefix"
		| "setCategory"
		| "setQuery"
		| "setSelected"
		| "loading"
		| "t"
	>,
) {
	const {
		detail,
		folders,
		images,
		prefix,
		setCategory,
		setQuery,
		setSelected,
		loading,
		t,
	} = props;
	return (
		<div
			data-mobile-photos-list
			className={`${detail ? "hidden" : "block"} min-h-0 flex-1 overflow-auto overscroll-contain p-3`}
		>
			<div className="flex flex-col gap-3">
				{[...folders].sort().map((folder) => (
					<button
						key={folder}
						type="button"
						onClick={() => {
							setCategory(prefix + folder);
							setQuery("");
						}}
						className="flex min-h-16 items-center gap-3 rounded-xl border border-border px-4 py-3 text-left text-[16px] font-semibold"
					>
						<Folder size={24} />
						<span className="min-w-0 flex-1 break-words">{folder}</span>
						<ChevronRight size={20} />
					</button>
				))}
				{images.map((image) => (
					<button
						key={image.file}
						data-mobile-photo-entry
						type="button"
						onClick={() => setSelected(image.file)}
						className="overflow-hidden rounded-xl border border-border text-left"
					>
						<img
							src={imagePath(image.file, true)}
							onError={(event) => {
								const original = imagePath(image.file);
								if (event.currentTarget.getAttribute("src") !== original)
									event.currentTarget.src = original;
							}}
							alt=""
							loading="lazy"
							className="h-44 w-full bg-white object-contain"
						/>
						<span className="block min-h-16 break-words px-4 py-3 text-[16px] font-semibold">
							{image.title ?? image.filename ?? image.file}
						</span>
					</button>
				))}
				{!loading && !images.length && !folders.size && (
					<p className="p-4 text-[16px] text-text-3">{t("mobile_no_images")}</p>
				)}
			</div>
		</div>
	);
}
