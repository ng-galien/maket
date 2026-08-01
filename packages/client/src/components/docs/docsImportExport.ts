export function exportMaketBundle(names: string[]): void {
	const qs =
		names.length === 1
			? `name=${encodeURIComponent(names[0] ?? "")}`
			: `names=${encodeURIComponent(names.join(","))}`;
	const a = document.createElement("a");
	a.href = `/api/export-maket?${qs}`;
	a.rel = "noopener";
	document.body.appendChild(a);
	a.click();
	a.remove();
}

export async function importMaketBundle(file: File): Promise<{
	ok: boolean;
	message: string;
	count: number;
}> {
	try {
		const res = await fetch("/api/import-maket", {
			method: "POST",
			headers: { "Content-Type": "application/gzip" },
			body: file,
		});
		const json = (await res.json()) as {
			error?: string;
			documents?: string[];
		};
		if (!res.ok)
			return {
				ok: false,
				message: json.error || `HTTP ${res.status}`,
				count: 0,
			};
		return { ok: true, message: "", count: json.documents?.length ?? 0 };
	} catch (e) {
		return { ok: false, message: (e as Error).message, count: 0 };
	}
}
