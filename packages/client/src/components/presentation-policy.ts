export type PresentationSurface = "canvas" | "reader";
export type PresentationDataSource = "connected" | "static";
export type PresentationAccess = "writable" | "locked" | "read-only";

export interface PresentationPolicy {
	surface: PresentationSurface;
	dataSource: PresentationDataSource;
	access: PresentationAccess;
	authoring: boolean;
	annotations: boolean;
	stateRepresentation: "canvas" | "live";
	stateControls: "persist" | "local" | "disabled";
	showGuides: boolean;
	showDiagnostics: boolean;
	showPendingMarkers: boolean;
	showPreviewOutline: boolean;
}

export function presentationPolicy({
	surface,
	dataSource,
	access,
	annotating = false,
}: {
	surface: PresentationSurface;
	dataSource: PresentationDataSource;
	access: PresentationAccess;
	annotating?: boolean;
}): PresentationPolicy {
	const reader = surface === "reader";
	const writable = access === "writable";
	const annotations = annotating && dataSource === "connected" && writable;
	return {
		surface,
		dataSource,
		access,
		authoring:
			!annotations && !reader && dataSource === "connected" && writable,
		annotations,
		stateRepresentation: reader ? "live" : "canvas",
		stateControls: annotations
			? "disabled"
			: writable
				? "persist"
				: reader && dataSource === "static" && access === "read-only"
					? "local"
					: "disabled",
		showGuides: !reader,
		showDiagnostics: !reader,
		showPendingMarkers: !reader || annotations,
		showPreviewOutline: !reader,
	};
}
