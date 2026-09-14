/** The server resolves the selected collection rows for both output routes. */
export async function printDocument(name: string): Promise<void> {
	if (window.maketDesktop) {
		await window.maketDesktop.runtime.printDocument(name);
		return;
	}
	window.open(`/print?${new URLSearchParams({ name })}`, "_blank", "noopener");
}

export async function exportDocumentPdf(name: string): Promise<void> {
	if (window.maketDesktop) {
		await window.maketDesktop.runtime.exportPdf(name);
		return;
	}
	const link = document.createElement("a");
	link.href = `/api/export-pdf?${new URLSearchParams({ name })}`;
	link.download = `${name}.pdf`;
	link.click();
}
