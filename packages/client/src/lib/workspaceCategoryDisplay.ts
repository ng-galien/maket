const STRUCTURED_WORKSPACES_CATEGORY = "Structured Workspaces";

export function displayWorkspaceCategorySegment(
	segment: string,
	workspaceLabel: string,
): string {
	return segment === STRUCTURED_WORKSPACES_CATEGORY ? workspaceLabel : segment;
}

export function displayWorkspaceCategoryPath(
	path: string,
	workspaceLabel: string,
): string {
	return path
		.split("/")
		.map((segment) => displayWorkspaceCategorySegment(segment, workspaceLabel))
		.join("/");
}
