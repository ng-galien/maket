/**
 * Browser-side `.maket` v2 encoder for the demo's "take it with you" step —
 * mirrors the server's `encodeBundleV2` manifest shape so the downloaded
 * bundle re-imports into any Maket install.
 */

import { buildBundleManifest } from "@maket/shared";
import JSZip from "jszip";
import type { DemoWorkspace } from "./scenario";

export async function encodeWorkspaceBundle(
	workspace: DemoWorkspace,
): Promise<Blob> {
	const zip = new JSZip();
	const manifest = buildBundleManifest(
		workspace.documents,
		workspace.chartes,
		workspace.collections,
		{
			version: 2,
			exportedAt: new Date().toISOString(),
			documentStates: Object.entries(workspace.documentStates ?? {}).map(
				([docName, state]) => {
					const doc = workspace.documents.find((item) => item.name === docName);
					if (!doc) {
						throw new Error(
							`State-backed demo document "${docName}" is missing.`,
						);
					}
					return {
						documentId: doc.id,
						schema: state.schema,
						data: state.data,
					};
				},
			),
		},
	);
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
