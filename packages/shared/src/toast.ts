import { MESSAGE_KEYS } from "./messages.js";

/** Toast keys carried over WebSocket and translated by the browser. */
export const TOAST_KEYS = [
	"toast_document_created",
	"toast_document_deleted",
	"toast_document_cloned",
	"toast_document_renamed",
	"toast_document_locked",
	"toast_document_unlocked",
	"toast_document_name_taken",
	"toast_document_locked_meta",
	"toast_document_locked_delete",
	"toast_document_locked_rename",
	"toast_category_cycle",
	"toast_category_locked_document",
	"toast_category_moved",
	"toast_asset_category_cycle",
	"toast_charte_name_required",
	"toast_charte_rejected",
	"toast_charte_saved",
	"toast_collection_saved",
	"toast_collection_deleted",
	"toast_collection_payload_invalid",
	"toast_bundle_imported",
	"toast_detail",
	...MESSAGE_KEYS,
] as const;

export type ToastKey = (typeof TOAST_KEYS)[number];

export type ToastLevel = "info" | "success" | "error";
