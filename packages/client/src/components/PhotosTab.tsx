import type { AssetsListItem, AssetsListResponse } from "@maket/shared";
import { ArrowLeft, ImagePlus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useT } from "../i18n/useT";
import { useStore } from "../store/useStore";
import { wsSend } from "../store/ws";

type ImageAsset = AssetsListItem;

export function PhotosTab() {
	const t = useT();
	const [images, setImages] = useState<ImageAsset[]>([]);
	const [activeFilter, setActiveFilter] = useState("Tous");
	const [loading, setLoading] = useState(true);
	const [selected, setSelected] = useState<ImageAsset | null>(null);

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

	// Re-fetch when assets change (import/delete via MCP)
	useEffect(() => {
		const handler = () => fetchImages();
		window.addEventListener("assets-changed", handler);
		return () => window.removeEventListener("assets-changed", handler);
	}, [fetchImages]);

	const categories = [
		"Tous",
		...new Set(images.map((img) => img.category || "").filter(Boolean)),
	];
	const filtered =
		activeFilter === "Tous"
			? images
			: images.filter((img) => img.category === activeFilter);

	const [uploading, setUploading] = useState<{
		total: number;
		done: number;
		errors: string[];
	} | null>(null);
	const [dragOver, setDragOver] = useState(false);

	const handleUpload = useCallback(async (files: FileList) => {
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

		// Notify Claude to classify the new images
		const uploaded = Array.from(files)
			.map((f) => f.name)
			.filter((n) => !state.errors.includes(n));
		if (uploaded.length > 0) {
			useStore.getState().addPending({
				id: crypto.randomUUID(),
				type: "classify-images",
				text: t("pending_classify_images", {
					files: uploaded.join(", "),
					count: String(uploaded.length),
				}),
				ts: Date.now(),
			});
		}

		// Keep the status briefly so the user sees "done"
		setTimeout(() => setUploading(null), state.errors.length ? 3000 : 800);
	}, []);

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

	return (
		<div
			className={`flex ${barPosition === "bottom" ? "flex-col-reverse" : "flex-col"} gap-3 py-1`}
		>
			{/* Upload zone */}
			<div
				role="button"
				tabIndex={0}
				onKeyDown={(e) => {
					if (e.key === "Enter" && !uploading) {
						const input = document.createElement("input");
						input.type = "file";
						input.accept = "image/*";
						input.multiple = true;
						input.onchange = () => {
							if (input.files) handleUpload(input.files);
						};
						input.click();
					}
				}}
				className={`mx-2 py-5 border-2 border-dashed rounded-xl text-center cursor-pointer transition-all ${
					dragOver
						? "border-accent bg-accent-soft text-accent scale-[1.02]"
						: uploading
							? "border-accent-border bg-accent-soft/50 text-accent pointer-events-none"
							: "border-border text-text-3 hover:border-accent-border hover:bg-accent-soft hover:text-accent"
				}`}
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
				onClick={() => {
					if (uploading) return;
					const input = document.createElement("input");
					input.type = "file";
					input.accept = "image/*";
					input.multiple = true;
					input.onchange = () => {
						if (input.files) handleUpload(input.files);
					};
					input.click();
				}}
			>
				{uploading ? (
					<>
						{/* Progress bar */}
						<div className="mx-6 h-1.5 rounded-full bg-border overflow-hidden">
							<div
								className="h-full bg-accent rounded-full transition-all duration-300"
								style={{
									width: `${(uploading.done / uploading.total) * 100}%`,
								}}
							/>
						</div>
						<div className="text-xs font-semibold mt-2">
							{t("upload_progress", {
								done: String(uploading.done),
								total: String(uploading.total),
							})}
						</div>
						{uploading.errors.length > 0 && (
							<div className="text-xs text-danger mt-1">
								{uploading.errors
									.map((f) => t("upload_error", { file: f }))
									.join(", ")}
							</div>
						)}
					</>
				) : (
					<>
						<div className="text-3xl font-light leading-none">+</div>
						<div className="text-xs mt-1">{t("upload_drop")}</div>
					</>
				)}
			</div>

			{/* Filters */}
			{categories.length > 1 && (
				<div className="flex gap-1.5 px-3 flex-wrap">
					{categories.map((f) => (
						<button
							key={f}
							onClick={() => setActiveFilter(f)}
							className={`text-xs font-semibold px-3.5 py-1.5 rounded-full transition-all ${
								activeFilter === f
									? "bg-text-1 text-white"
									: "bg-input text-text-2 hover:bg-border"
							}`}
						>
							{f}
						</button>
					))}
				</div>
			)}

			{/* Grid */}
			{loading ? (
				<div className="text-center text-text-3 text-xs py-6">
					{t("loading")}
				</div>
			) : filtered.length === 0 ? (
				<div className="text-center text-text-3 text-xs py-6">
					{t("no_image")}
				</div>
			) : (
				<div className="grid grid-cols-2 gap-2 px-3">
					{filtered.map((img) => (
						<div
							key={img.file}
							onClick={() => setSelected(img)}
							className="aspect-[4/3] rounded-lg relative overflow-hidden cursor-pointer hover:scale-[1.03] transition-transform group"
						>
							<img
								src={`/assets/thumb/${img.file}`}
								alt={img.title || img.file}
								className="w-full h-full object-cover"
								loading="lazy"
								decoding="async"
								draggable={false}
							/>
							<div className="absolute inset-x-0 bottom-0 px-2 py-1.5 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
								<span className="text-[10px] font-semibold text-white">
									{img.title || img.file}
								</span>
							</div>
						</div>
					))}
				</div>
			)}
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
					<div className="text-[14px] font-bold truncate">
						{img.title || img.file}
					</div>
					<div className="text-[11px] text-text-3">{img.file}</div>
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

			{/* Info */}
			{img.description && (
				<p className="text-[12px] text-text-2 leading-relaxed">
					{img.description}
				</p>
			)}

			<div className="flex flex-wrap gap-2">
				{img.width && img.height && (
					<span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-input text-text-2">
						{img.width} × {img.height}
					</span>
				)}
				{img.orientation && (
					<span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-input text-text-2">
						{img.orientation}
					</span>
				)}
				{img.category && (
					<span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-accent-soft text-accent">
						{img.category}
					</span>
				)}
			</div>

			{img.tags && Array.isArray(img.tags) && img.tags.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{img.tags.map((tag: string) => (
						<span
							key={tag}
							className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-input text-text-3"
						>
							{tag}
						</span>
					))}
				</div>
			)}

			{/* Actions */}
			<div className="flex gap-2">
				{onInsert && (
					<button
						type="button"
						onClick={() => onInsert(img.file)}
						className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold bg-accent text-white hover:brightness-110 transition flex items-center justify-center gap-2"
					>
						<ImagePlus size={16} />
						{t("insert_in_doc")}
					</button>
				)}
				<button
					type="button"
					onClick={() => onDelete(img.file)}
					className="py-2.5 px-3 rounded-xl text-[13px] font-semibold border border-danger-border text-danger hover:bg-danger-soft transition flex items-center justify-center"
				>
					<Trash2 size={16} />
				</button>
			</div>
		</div>
	);
}
