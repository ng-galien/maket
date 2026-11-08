import {
	parseJsonPointer,
	type StructuredWorkspaceDataSource,
	type StructuredWorkspaceRepresentationSchema,
} from "@maket/shared";
import { z } from "zod";
import { itemSourceError } from "./item-source-error.js";

const pointer = z.string().refine((value) => {
	try {
		parseJsonPointer(value);
		return true;
	} catch {
		return false;
	}
}, "Expected a JSON Pointer");
const parameter = z.string().min(1);
export const dataSourceSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("local") }).strict(),
	z
		.object({
			kind: z.literal("http"),
			baseUrl: z
				.string()
				.url()
				.refine((value) => {
					const url = new URL(value);
					return (
						["https:", "http:"].includes(url.protocol) &&
						!url.username &&
						!url.password &&
						!url.search &&
						!url.hash
					);
				}, "Expected an HTTP base URL without credentials, query or fragment"),
			collectionId: z.string().min(1),
			bindingId: z.string().min(1),
			auth: z
				.string()
				.regex(/^env:[A-Za-z_][A-Za-z0-9_]*$/)
				.optional(),
			list: z
				.object({
					path: z.string().min(1),
					params: z
						.object({
							cursor: parameter,
							limit: parameter,
							text: parameter.optional(),
							sort: parameter,
							filters: parameter.optional(),
						})
						.strict(),
					itemsPointer: pointer,
					nextPointer: pointer,
					totalPointer: pointer.optional(),
					revisionPointer: pointer.optional(),
				})
				.strict(),
			get: z
				.object({
					path: z
						.string()
						.refine(
							(value) => value.includes("{id}"),
							"Expected a detail path with {id}",
						),
					dataPointer: pointer.optional(),
					revisionPointer: pointer.optional(),
				})
				.strict(),
		})
		.strict(),
]);

export function validateDataSource(
	source: StructuredWorkspaceDataSource | undefined,
	representation: StructuredWorkspaceRepresentationSchema,
): void {
	if (source === undefined) return;
	const parsed = dataSourceSchema.safeParse(source);
	if (!parsed.success)
		throw itemSourceError(
			"invalid_record",
			`data_source: ${parsed.error.message}`,
		);
	if (source.kind === "local") return;
	const collection = representation.collections[source.collectionId];
	if (
		Object.keys(representation.collections).length !== 1 ||
		!collection ||
		!collection.bindings[source.bindingId] ||
		Object.keys(collection.bindings).length !== 1
	)
		throw itemSourceError(
			"invalid_record",
			"The first HTTP read connector needs one declared collection and binding matching data_source.collectionId and bindingId.",
		);
	if (!collection.identity || !collection.sortBy)
		throw itemSourceError(
			"invalid_record",
			"An HTTP collection needs a declared identity and sortBy: the external source has no Maket insertion order.",
		);
	if (collection.groupBy !== undefined)
		throw itemSourceError(
			"query_unsupported",
			"The first HTTP read connector does not provide group counts; omit groupBy.",
		);
	const names = Object.values(source.list.params);
	if (new Set(names).size !== names.length)
		throw itemSourceError(
			"invalid_record",
			"HTTP query parameter names must be distinct.",
		);
	for (const path of [
		source.list.path,
		source.get.path.replace("{id}", "item"),
	]) {
		const target = new URL(
			path,
			source.baseUrl.endsWith("/") ? source.baseUrl : `${source.baseUrl}/`,
		);
		if (
			target.origin !== new URL(source.baseUrl).origin ||
			target.username ||
			target.password ||
			target.hash
		)
			throw itemSourceError(
				"invalid_record",
				"HTTP list/get paths must stay on the declared source origin without credentials or fragments.",
			);
	}
}
