export type PresentationSurface = "canvas" | "reader";
export type PresentationDataSource = "connected" | "static";
export type PresentationAccess = "writable" | "locked" | "read-only";

export interface PresentationPolicy {
	surface: PresentationSurface;
	dataSource: PresentationDataSource;
	access: PresentationAccess;
	authoring: boolean;
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
}: {
	surface: PresentationSurface;
	dataSource: PresentationDataSource;
	access: PresentationAccess;
}): PresentationPolicy {
	const reader = surface === "reader";
	const writable = access === "writable";
	return {
		surface,
		dataSource,
		access,
		authoring: !reader && dataSource === "connected" && writable,
		stateRepresentation: reader ? "live" : "canvas",
		stateControls: writable
			? "persist"
			: reader && dataSource === "static" && access === "read-only"
				? "local"
				: "disabled",
		showGuides: !reader,
		showDiagnostics: !reader,
		showPendingMarkers: !reader,
		showPreviewOutline: !reader,
	};
}
