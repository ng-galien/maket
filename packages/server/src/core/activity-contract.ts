import { ACTIVITY_KEYS, type ActivityKey } from "@maket/shared";
import type { ToolHandler } from "./container.js";

interface ConditionalActivity {
	key: ActivityKey;
	when: (args: Record<string, unknown>) => boolean;
}

type ActivityRule = ActivityKey | ConditionalActivity | null;

interface ActivityPolicy {
	icon: string;
	key?: ActivityRule;
	actions?: Record<string, ActivityRule>;
}

export interface ResolvedActivity {
	icon: string;
	key: ActivityKey;
}

/** Every tool action must explicitly be visible (a key) or silent (null). */
export const ACTIVITY_POLICIES = {
	maket_doc: {
		icon: "folder-open",
		actions: {
			new: "bubble_maket_doc_new",
			list: "bubble_maket_doc_list",
			delete: "bubble_maket_doc_delete",
			duplicate: "bubble_maket_doc_duplicate",
			rename: "bubble_maket_doc_rename",
			meta: "bubble_maket_doc_meta",
			export: "bubble_maket_doc_export",
			import: "bubble_maket_doc_import",
		},
	},
	maket_page: {
		icon: "file-plus-2",
		actions: {
			add: "bubble_maket_page_add",
			remove: "bubble_maket_page_remove",
			rename: "bubble_maket_page_rename",
			reorder: "bubble_maket_page_reorder",
			list: null,
		},
	},
	maket_canvas: { icon: "ruler", key: "bubble_maket_canvas" },
	maket_html: {
		icon: "file-pen",
		actions: {
			set: "bubble_maket_html_set",
			patch: "bubble_maket_html_patch",
			get: null,
			check: "bubble_maket_html_check",
		},
	},
	maket_workspace: {
		icon: "pin",
		actions: {
			focus: "bubble_maket_workspace_focus",
			state: "bubble_maket_workspace_state",
			lock: "bubble_maket_workspace_lock",
			fit_view: "bubble_maket_workspace_fit_view",
			list_messages: "bubble_maket_workspace_list_messages",
			ack_messages: "bubble_maket_workspace_ack_messages",
		},
	},
	maket_charte: {
		icon: "palette",
		actions: {
			list: "bubble_maket_charte_list",
			view: "bubble_maket_charte_view",
			set: "bubble_maket_charte_set",
			delete: "bubble_maket_charte_delete",
		},
	},
	maket_collection: {
		icon: "table",
		actions: {
			list: "bubble_maket_collection_list",
			view: "bubble_maket_collection_view",
			create: "bubble_maket_collection_create",
			validate_schema: "bubble_maket_collection_validate_schema",
			change_schema: "bubble_maket_collection_change_schema",
			add_row: "bubble_maket_collection_add_row",
			update_row: "bubble_maket_collection_update_row",
			delete_row: "bubble_maket_collection_delete_row",
			delete: "bubble_maket_collection_delete",
			bind: "bubble_maket_collection_bind",
			unbind: "bubble_maket_collection_unbind",
			cursor: {
				key: "bubble_maket_collection_cursor",
				when: (args) => args.mode !== undefined || args.row !== undefined,
			},
		},
	},
	maket_state: {
		icon: "history",
		actions: {
			init: "bubble_maket_state_init",
			get: null,
			update: "bubble_maket_state_update",
			history: null,
			revision: null,
			restore: "bubble_maket_state_restore",
			diff: null,
		},
	},
	maket_learn: {
		icon: "graduation-cap",
		key: null,
		actions: { overview: null, topics: null, topic: null },
	},
	maket_image: {
		icon: "images",
		actions: {
			list: "bubble_maket_image_list",
			view: "bubble_maket_image_view",
			meta: "bubble_maket_image_meta",
			import: "bubble_maket_image_import",
			delete: "bubble_maket_image_delete",
		},
	},
	maket_preview: {
		icon: "eye",
		actions: {
			open: "bubble_maket_preview_open",
			snapshot: "bubble_maket_preview_snapshot",
		},
	},
	maket_mermaid: { icon: "git-branch", key: "bubble_maket_mermaid" },
	maket_pdf: { icon: "download", key: "bubble_maket_pdf" },
	maket_gmail: {
		icon: "send",
		actions: {
			connect: "bubble_maket_gmail",
			search: "bubble_maket_gmail",
			read: "bubble_maket_gmail",
			draft: "bubble_maket_gmail",
			fetch_attachment: "bubble_maket_gmail",
		},
	},
} as const satisfies Record<string, ActivityPolicy>;

export function resolveActivity(
	toolName: string,
	args: Record<string, unknown>,
): ResolvedActivity | null {
	const policy = (ACTIVITY_POLICIES as Record<string, ActivityPolicy>)[
		toolName
	];
	if (!policy) throw new Error(`Missing activity policy for tool: ${toolName}`);
	const action = args.action;
	const rule =
		typeof action === "string" ? policy.actions?.[action] : policy.key;
	if (rule === undefined) {
		throw new Error(
			`Missing activity policy for call: ${toolName}${typeof action === "string" ? ` action=${action}` : ""}`,
		);
	}
	const key = activityKey(rule, args);
	return key === null ? null : { icon: policy.icon, key };
}

function activityKey(
	rule: ActivityRule,
	args: Record<string, unknown>,
): ActivityKey | null {
	if (rule === null || typeof rule === "string") return rule;
	return rule.when(args) ? rule.key : null;
}

export function assertActivityContract(
	toolRegistry: Map<string, ToolHandler>,
): void {
	const errors = activityContractErrors(toolRegistry);
	if (errors.length > 0)
		throw new Error(`Activity contract drift — ${errors.join("; ")}`);
}

function activityContractErrors(
	toolRegistry: Map<string, ToolHandler>,
): string[] {
	const policies = ACTIVITY_POLICIES as Record<string, ActivityPolicy>;
	const errors: string[] = [];
	for (const [toolName, tool] of toolRegistry) {
		errors.push(...toolPolicyErrors(toolName, tool, policies[toolName]));
	}
	errors.push(...staleToolPolicyErrors(toolRegistry, policies));
	errors.push(...unusedActivityKeyErrors(policies));
	return errors;
}

function toolPolicyErrors(
	toolName: string,
	tool: ToolHandler,
	policy: ActivityPolicy | undefined,
): string[] {
	if (!policy) return [`${toolName}: missing tool policy`];
	const actions = enumValues(tool.metadata.schema.shape.action);
	if (!actions)
		return Object.hasOwn(policy, "key")
			? []
			: [`${toolName}: missing default policy`];
	return actionPolicyErrors(toolName, actions, policy.actions ?? {});
}

function actionPolicyErrors(
	toolName: string,
	actions: string[],
	policies: Record<string, ActivityRule>,
): string[] {
	const missing = actions
		.filter((action) => !Object.hasOwn(policies, action))
		.map((action) => `${toolName}: missing action policy for ${action}`);
	const stale = Object.keys(policies)
		.filter((action) => !actions.includes(action))
		.map((action) => `${toolName}: stale action policy for ${action}`);
	return [...missing, ...stale];
}

function staleToolPolicyErrors(
	toolRegistry: Map<string, ToolHandler>,
	policies: Record<string, ActivityPolicy>,
): string[] {
	return Object.keys(policies)
		.filter((toolName) => !toolRegistry.has(toolName))
		.map((toolName) => `${toolName}: stale tool policy`);
}

function unusedActivityKeyErrors(
	policies: Record<string, ActivityPolicy>,
): string[] {
	const usedKeys = new Set<ActivityKey>();
	for (const policy of Object.values(policies)) {
		const defaultKey = policy.key && policyRuleKey(policy.key);
		if (defaultKey) usedKeys.add(defaultKey);
		for (const rule of Object.values(policy.actions ?? {})) {
			const key = rule && policyRuleKey(rule);
			if (key) usedKeys.add(key);
		}
	}
	return ACTIVITY_KEYS.filter((key) => !usedKeys.has(key)).map(
		(key) => `${key}: unused activity key`,
	);
}

function policyRuleKey(rule: Exclude<ActivityRule, null>): ActivityKey {
	return typeof rule === "string" ? rule : rule.key;
}

function enumValues(schema: unknown): string[] | null {
	if (!schema || typeof schema !== "object") return null;
	let candidate = schema as { options?: unknown; unwrap?: () => unknown };
	if (typeof candidate.unwrap === "function") {
		const unwrapped = candidate.unwrap();
		if (!unwrapped || typeof unwrapped !== "object") return null;
		candidate = unwrapped as { options?: unknown };
	}
	return Array.isArray(candidate.options) &&
		candidate.options.every((value) => typeof value === "string")
		? candidate.options
		: null;
}
