import type { DocSummary } from "../store/types";

/** Pinned documents, most recently pinned first; equal stamps fall back to name. */
export function pinnedDocuments<
	T extends Pick<DocSummary, "name" | "pinnedAt">,
>(docs: readonly T[]): T[] {
	return docs
		.filter((doc) => doc.pinnedAt)
		.sort(
			(a, b) =>
				(b.pinnedAt ?? "").localeCompare(a.pinnedAt ?? "") ||
				a.name.localeCompare(b.name),
		);
}
