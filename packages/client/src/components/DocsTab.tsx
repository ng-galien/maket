import { FileText } from "lucide-react";
import { useState } from "react";
import { useT } from "../i18n/useT";
import { useStore, useWorkspaceDocNames } from "../store/useStore";
import { sendLoadDoc } from "../store/ws";

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

export function DocsTab() {
	const t = useT();
	const docList = useStore((s) => s.docList);
	const workspaceDocNames = useWorkspaceDocNames();
	const barPosition = useStore((s) => s.barPosition);
	const removeDoc = useStore((s) => s.removeDocFromWorkspace);
	const [search, setSearch] = useState("");

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
					className="w-full px-3 py-2 bg-input rounded-lg text-[13px] outline-none placeholder:text-text-3 focus:ring-2 focus:ring-accent/20"
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
						<span className="text-[11px] font-bold text-text-3 uppercase tracking-wider flex-1">
							{cat}
						</span>
						<span className="text-[11px] text-text-3">{docs.length}</span>
					</div>

					{/* Doc list */}
					<div className="flex flex-col gap-0.5">
						{docs.map((d) => {
							const onWs = isOnWorkspace(d.name);
							return (
								<button
									type="button"
									key={d.name}
									onClick={() => toggleDoc(d.name)}
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
											className={`text-[13px] truncate ${onWs ? "font-bold text-accent" : "font-medium text-text-1"}`}
										>
											{d.name}
										</div>
										<div className="flex items-center gap-1.5 mt-0.5">
											<span className="text-[10px] font-bold text-text-3">
												{d.format}
											</span>
											<span className="text-[10px] text-text-3">
												{d.pageCount ?? 1}p
											</span>
										</div>
									</div>
									{onWs && (
										<span className="text-[10px] font-bold text-accent">✓</span>
									)}
								</button>
							);
						})}
					</div>
				</div>
			))}

			{filtered.length === 0 && (
				<div className="px-4 py-6 text-center text-[13px] text-text-3">
					{t("no_document")}
				</div>
			)}
		</div>
	);
}
