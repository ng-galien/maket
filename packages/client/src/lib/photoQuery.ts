import type { AssetsListItem } from "@maket/shared";

/** Shared matching semantics for the photo library and placement picker. */
export function photoMatchesQuery(
	img: AssetsListItem,
	query: { categories: string[]; text: string },
): boolean {
	const category = img.category?.toLowerCase() ?? "";
	if (
		query.categories.length > 0 &&
		!query.categories.some(
			(filter) => category === filter || category.startsWith(`${filter}/`),
		)
	)
		return false;
	if (!query.text) return true;
	const values = [
		img.file,
		img.title,
		img.description,
		img.category,
		...(img.tags ?? []),
	];
	return values.some((value) => value?.toLowerCase().includes(query.text));
}
