export const DEFAULT_CATEGORY_PATH = "general";

/**
 * Categories stay persisted as strings. Slashes only add an interpreted
 * hierarchy, so every write path shares the same small normalization rule.
 */
export function normalizeCategoryPath(value?: string | null): string {
	const normalized = (value ?? "")
		.split("/")
		.map((segment) => segment.trim())
		.filter(Boolean)
		.join("/");
	return normalized || DEFAULT_CATEGORY_PATH;
}

export function categoryPathSegments(value?: string | null): string[] {
	return normalizeCategoryPath(value).split("/");
}

export function categoryPathContains(
	category: string | null | undefined,
	parent: string,
): boolean {
	const normalizedCategory = normalizeCategoryPath(category).toLowerCase();
	const normalizedParent = normalizeCategoryPath(parent).toLowerCase();
	return (
		normalizedCategory === normalizedParent ||
		normalizedCategory.startsWith(`${normalizedParent}/`)
	);
}
