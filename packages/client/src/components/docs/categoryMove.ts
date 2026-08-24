import { normalizeCategoryPath } from "@maket/shared";
import { useState } from "react";
import type { CategoryMoveTarget, CategoryPickerModel } from "./types";

type ItemMoveTarget = Exclude<CategoryMoveTarget, { kind: "category" }>;

export function useCategoryMove(
	categories: string[],
	moveItem: (target: ItemMoveTarget, category: string) => void,
	moveCategory: (source: string, destination: string) => void,
) {
	const [target, setTarget] = useState<CategoryMoveTarget | null>(null);
	const model: CategoryPickerModel = {
		target,
		categories,
		close: () => setTarget(null),
		moveTo: (path) => {
			if (!target) return;
			if (target.kind === "category") {
				const destination = categoryDestinationUnder(target.path, path);
				if (destination && destination !== target.path) {
					moveCategory(target.path, destination);
				}
			} else {
				const category = normalizeCategoryPath(path);
				if (category !== normalizeCategoryPath(target.category)) {
					moveItem(target, category);
				}
			}
			setTarget(null);
		},
	};
	return {
		model,
		requestItemMove: (item: ItemMoveTarget) => setTarget(item),
		requestCategoryMove: (path: string) =>
			setTarget({ kind: "category", path }),
	};
}

export function categoryRenameDestination(
	source: string,
	nextName: string,
): string | null {
	const leaf = normalizeCategoryPath(nextName).split("/").at(-1);
	if (!leaf) return null;
	const parent = source.split("/").slice(0, -1).join("/");
	return parent ? `${parent}/${leaf}` : leaf;
}

function categoryDestinationUnder(
	source: string,
	parent: string,
): string | null {
	const leaf = source.split("/").at(-1);
	if (!leaf) return null;
	const normalizedParent = parent ? normalizeCategoryPath(parent) : "";
	return normalizedParent ? `${normalizedParent}/${leaf}` : leaf;
}
