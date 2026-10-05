import {
	type StructuredWorkspaceTemplateDocumentView,
	type StructuredWorkspaceView,
	structuredWorkspaceBindingSchema,
} from "@maket/shared";

type TemplateRole = StructuredWorkspaceTemplateDocumentView["roles"][number];
type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

export interface StructuredWorkspaceTemplateSchemaView {
	workspaceName: string;
	documentName: string;
	value: JsonValue;
}

export function structuredWorkspaceTemplateSchemaView(
	workspaces: readonly StructuredWorkspaceView[],
	documentName: string | undefined,
): StructuredWorkspaceTemplateSchemaView | null {
	if (!documentName) return null;
	for (const workspace of workspaces) {
		const template = workspace.templateDocuments.find(
			(candidate) => candidate.documentName === documentName,
		);
		if (!template) continue;
		const roles = [...template.roles]
			.sort(compareTemplateRoles)
			.map((role) => roleSchemaView(workspace, role));
		return {
			workspaceName: workspace.name,
			documentName,
			value:
				roles.length === 1
					? (roles[0] as JsonValue)
					: ({ documentName, roles } as JsonValue),
		};
	}
	return null;
}

function roleSchemaView(
	workspace: StructuredWorkspaceView,
	role: TemplateRole,
): JsonValue {
	const collection =
		workspace.representationSchema.collections[role.collectionId];
	if (!collection) {
		return {
			role: role.role,
			collectionId: role.collectionId,
			error: `Collection "${role.collectionId}" is missing.`,
		};
	}
	if (role.role === "collection") {
		return {
			role: "collection",
			collectionId: role.collectionId,
			collectionName: collection.name,
			dataSchema: workspace.dataSchema as JsonValue,
			representation: collection as unknown as JsonValue,
		};
	}
	const bindingId = role.bindingId ?? "";
	const binding = collection.bindings[bindingId];
	if (!binding) {
		return {
			role: role.role,
			collectionId: role.collectionId,
			collectionName: collection.name,
			bindingId,
			error: `Binding "${role.collectionId}.${bindingId}" is missing.`,
		};
	}
	try {
		return {
			role: role.role,
			collectionId: role.collectionId,
			collectionName: collection.name,
			bindingId,
			schemaPath: binding.schemaPath,
			schema: structuredWorkspaceBindingSchema(
				workspace.dataSchema,
				binding,
			) as JsonValue,
		};
	} catch (error) {
		return {
			role: role.role,
			collectionId: role.collectionId,
			collectionName: collection.name,
			bindingId,
			schemaPath: binding.schemaPath,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function compareTemplateRoles(left: TemplateRole, right: TemplateRole): number {
	const order = { collection: 0, compact: 1, detail: 2 } as const;
	return (
		left.collectionId.localeCompare(right.collectionId) ||
		order[left.role] - order[right.role] ||
		(left.bindingId ?? "").localeCompare(right.bindingId ?? "")
	);
}
