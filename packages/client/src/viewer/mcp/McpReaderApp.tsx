/**
 * The Maket reader inside MCP Apps hosts (resource ui://maket/page). The
 * tool result that opens it carries `structuredContent.maketReader`: a mode,
 * its content and its display settings. Each mode is a component of
 * READER_MODES, read from this same resource.
 */

import { type ComponentType, useEffect, useMemo, useState } from "react";
import { useT } from "../../i18n/useT";
import { applyColorScheme } from "../../lib/colorScheme";
import { useStore } from "../../store/useStore";
import {
	connectMcpApp,
	type HostContext,
	type McpAppBridge,
	type ToolResult,
} from "./bridge";
import { type DocumentOpening, DocumentReader } from "./document-mode";

/** Every mode the reader opens in; a new mode is a new member here and in
 * READER_MODES. */
export type ReaderOpening = DocumentOpening;

interface ModeProps<O> {
	opening: O;
	bridge: McpAppBridge;
}

const READER_MODES: {
	[K in ReaderOpening["mode"]]: ComponentType<
		ModeProps<Extract<ReaderOpening, { mode: K }>>
	>;
} = {
	document: DocumentReader,
};

/** Height of the reader in the conversation: a tall page scrolls inside. */
const READER_HEIGHT = 640;

export function readerOpening(result: ToolResult): ReaderOpening | null {
	const opening = result?.structuredContent?.maketReader as
		| ReaderOpening
		| undefined;
	if (!opening || typeof opening !== "object") return null;
	return opening.mode in READER_MODES ? opening : null;
}

export default function McpReaderApp() {
	const t = useT();
	const [opening, setOpening] = useState<ReaderOpening | null>(null);
	const [state, setState] = useState<"waiting" | "open" | "none">("waiting");
	const [height, setHeight] = useState(READER_HEIGHT);
	const darkMode = useStore((s) => s.darkMode);
	const bridge = useMemo(
		() =>
			connectMcpApp({
				onToolResult: (result) => {
					const next = readerOpening(result);
					setOpening(next);
					setState(next ? "open" : "none");
				},
				onHostContext: (context: HostContext) => {
					if (context.theme === "dark" || context.theme === "light")
						useStore.setState({ darkMode: context.theme === "dark" });
					const dimensions = context.containerDimensions;
					const limit = dimensions?.height ?? dimensions?.maxHeight;
					if (limit) setHeight(Math.min(READER_HEIGHT, limit));
				},
			}),
		[],
	);
	useEffect(() => applyColorScheme(darkMode), [darkMode]);
	useEffect(() => bridge.reportSize({ height }), [bridge, height]);

	const Mode = opening
		? (READER_MODES[opening.mode] as ComponentType<ModeProps<ReaderOpening>>)
		: null;
	return (
		<div
			data-maket-reader={opening?.mode ?? state}
			className="relative w-full overflow-hidden bg-[var(--color-app)]"
			style={{ height }}
		>
			{Mode && opening ? (
				<Mode
					key={`${opening.mode}:${opening.document.id}`}
					opening={opening}
					bridge={bridge}
				/>
			) : (
				<div
					role="status"
					className="flex h-full items-center justify-center text-sm text-text-3"
				>
					{state === "none"
						? t("reader_mcp_no_opening")
						: t("reader_mcp_waiting")}
				</div>
			)}
		</div>
	);
}
