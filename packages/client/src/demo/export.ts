/**
 * Browser-side `.maket` v2 encoder for the demo's "take it with you" step —
 * mirrors the server's `encodeBundleV2` manifest shape so the downloaded
 * bundle re-imports into any Maket install.
 */

import JSZip from "jszip";
import type { DemoWorkspace } from "./scenario";

export async function encodeWorkspaceBundle(
	workspace: DemoWorkspace,
): Promise<Blob> {
	const zip = new JSZip();
	const manifest = {
		version: 2,
		kind: "maket-bundle",
		exportedAt: new Date().toISOString(),
		documents: workspace.documents.map((doc) => ({
			id: doc.id,
			name: doc.name,
			category: doc.category || "general",
			canvas: doc.canvas,
			meta: doc.meta ?? {},
			pages: doc.pages.map((page) => ({
				id: page.id,
				name: page.name,
				elements: page.elements ?? [],
				html: page.html,
				collection: page.collection,
			})),
			activePage: doc.activePage ?? 0,
		})),
		chartes: workspace.chartes,
		collections: workspace.collections,
	};
	zip.file("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
	return zip.generateAsync({
		type: "blob",
		compression: "DEFLATE",
		compressionOptions: { level: 6 },
	});
}

export async function downloadWorkspaceBundle(
	workspace: DemoWorkspace,
	filename: string,
): Promise<void> {
	const blob = await encodeWorkspaceBundle(workspace);
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
