// ============================================================
// Localizable messages — the identifier the browser translates.
//
// Server errors have two audiences. MCP tool output is read by the AI agent
// and stays an English sentence; the same failure shown to the human must be
// a key it can translate. A message carries the identifier and its params, and
// travels beside the sentence rather than replacing it.
// ============================================================

export const MESSAGE_KEYS = [
	"msg_document_not_found",
	"msg_document_locked",
	"msg_document_no_state",
	"msg_page_not_found",
	"msg_state_root_not_terminal",
	"msg_state_terminal_only",
	"msg_state_path_not_bound",
	"msg_state_revision_not_found",
	"msg_state_revision_conflict",
	"msg_state_no_revision",
	"msg_state_invalid",
	"msg_state_not_object",
	"msg_collection_not_found",
	"msg_collection_in_use",
	"msg_collection_on_state_document",
	"msg_page_no_data_source",
	"msg_row_not_found",
	"msg_collection_no_rows",
	"msg_rendered_needs_row",
	"msg_annotation_not_saved",
] as const;

export type MessageKey = (typeof MESSAGE_KEYS)[number];

export interface LocalizedMessage {
	key: MessageKey;
	params?: Record<string, string | number>;
}
