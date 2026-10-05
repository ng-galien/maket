import { ChevronDown, ChevronRight } from "lucide-react";
import { useT } from "../i18n/useT";

export type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

export function StateJsonTree({
	value,
	query,
	collapsedPaths,
	onToggle,
	ariaLabel,
}: {
	value: JsonValue;
	query: string;
	collapsedPaths: ReadonlySet<string>;
	onToggle: (path: string) => void;
	ariaLabel?: string;
}) {
	const t = useT();
	return (
		<div
			role="tree"
			aria-label={ariaLabel ?? t("state_json_tree")}
			className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-xs leading-5"
		>
			<div className="min-w-max">
				<JsonNode
					value={value}
					path="$"
					depth={0}
					query={query}
					collapsedPaths={collapsedPaths}
					onToggle={onToggle}
				/>
			</div>
		</div>
	);
}

function JsonNode({
	value,
	path,
	depth,
	propertyName,
	query,
	collapsedPaths,
	onToggle,
}: {
	value: JsonValue;
	path: string;
	depth: number;
	propertyName?: string;
	query: string;
	collapsedPaths: ReadonlySet<string>;
	onToggle: (path: string) => void;
}) {
	const t = useT();
	if (!isJsonContainer(value)) {
		return (
			<div
				role="treeitem"
				tabIndex={-1}
				data-json-line
				data-json-path={path}
				data-json-depth={depth}
				className="whitespace-nowrap"
				style={nodeIndent(depth)}
			>
				<span className="inline-block w-5" aria-hidden />
				<JsonPropertyName name={propertyName} query={query} />
				<JsonPrimitive value={value} query={query} />
			</div>
		);
	}

	const entries = Object.entries(value);
	const array = Array.isArray(value);
	const collapsed = collapsedPaths.has(path);
	const opening = array ? "[" : "{";
	const closing = array ? "]" : "}";
	return (
		<div role="treeitem" tabIndex={-1}>
			<div
				data-json-line
				data-json-path={path}
				data-json-depth={depth}
				className="flex h-5 items-center whitespace-nowrap"
				style={nodeIndent(depth)}
			>
				<button
					type="button"
					onClick={() => onToggle(path)}
					aria-expanded={!collapsed}
					aria-label={t(
						collapsed ? "state_json_expand_node" : "state_json_collapse_node",
						{ path: readablePath(path) },
					)}
					className="relative z-[1] mr-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-xs bg-panel text-text-3 transition-colors hover:bg-input hover:text-text-1"
				>
					{collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
				</button>
				<JsonPropertyName name={propertyName} query={query} />
				<span className="text-text-2">
					{collapsed
						? `${opening} ${entries.length === 0 ? "" : "… "}${closing}`
						: opening}
				</span>
				{collapsed && entries.length > 0 && (
					<span className="ml-2 text-2xs text-text-3">
						{t(array ? "state_json_items" : "state_json_properties", {
							count: entries.length,
						})}
					</span>
				)}
			</div>
			{!collapsed && (
				<div role="group" className="relative">
					<span
						data-json-guide
						aria-hidden
						className="pointer-events-none absolute inset-y-0 w-px bg-border/70"
						style={guidePosition(depth)}
					/>
					{entries.map(([key, child]) => (
						<JsonNode
							key={key}
							value={child as JsonValue}
							path={childPath(path, key, array)}
							depth={depth + 1}
							propertyName={array ? undefined : key}
							query={query}
							collapsedPaths={collapsedPaths}
							onToggle={onToggle}
						/>
					))}
					<div
						className="whitespace-nowrap text-text-2"
						style={nodeIndent(depth)}
					>
						<span className="inline-block w-5" />
						{closing}
					</div>
				</div>
			)}
		</div>
	);
}

function JsonPropertyName({ name, query }: { name?: string; query: string }) {
	if (name === undefined) return null;
	return (
		<>
			<span className="text-editing">
				<HighlightedText text={JSON.stringify(name)} query={query} />
			</span>
			<span className="mr-1 text-text-2">: </span>
		</>
	);
}

function JsonPrimitive({ value, query }: { value: JsonValue; query: string }) {
	const serialized = JSON.stringify(value);
	if (typeof value === "string") {
		return (
			<span className="text-accent">
				<HighlightedText text={serialized} query={query} />
			</span>
		);
	}
	if (typeof value === "number") {
		return (
			<span className="text-warning">
				<HighlightedText text={serialized} query={query} />
			</span>
		);
	}
	return (
		<span className={value === null ? "italic text-text-3" : "text-danger"}>
			<HighlightedText text={serialized} query={query} />
		</span>
	);
}

// Syntax highlighting owns its small segmentation loop locally so render nodes
// receive React-ready fragments without a second representation of JSON text.
// code-moniker: ignore[maket-ownership-keeps-behavior-with-its-owner]
function HighlightedText({ text, query }: { text: string; query: string }) {
	if (!query) return text;
	const lowerText = text.toLocaleLowerCase();
	const parts: React.ReactNode[] = [];
	let cursor = 0;
	let matchIndex = lowerText.indexOf(query);
	while (matchIndex >= 0) {
		if (matchIndex > cursor) parts.push(text.slice(cursor, matchIndex));
		parts.push(
			<mark
				key={`${matchIndex}:${cursor}`}
				data-json-highlight
				className="rounded-xs bg-warning-soft text-inherit ring-1 ring-warning-border"
			>
				{text.slice(matchIndex, matchIndex + query.length)}
			</mark>,
		);
		cursor = matchIndex + query.length;
		matchIndex = lowerText.indexOf(query, cursor);
	}
	if (cursor < text.length) parts.push(text.slice(cursor));
	return parts;
}

export function countJsonMatches(value: JsonValue, query: string): number {
	if (!query) return 0;
	if (!isJsonContainer(value))
		return countTextMatches(JSON.stringify(value), query);
	return Object.entries(value).reduce(
		(count, [key, child]) =>
			count +
			(Array.isArray(value)
				? 0
				: countTextMatches(JSON.stringify(key), query)) +
			countJsonMatches(child as JsonValue, query),
		0,
	);
}

function countTextMatches(text: string, query: string): number {
	const lowerText = text.toLocaleLowerCase();
	let count = 0;
	let cursor = lowerText.indexOf(query);
	while (cursor >= 0) {
		count += 1;
		cursor = lowerText.indexOf(query, cursor + query.length);
	}
	return count;
}

export function allJsonContainerPaths(value: JsonValue): Set<string> {
	const paths = new Set<string>();
	visitContainers(value, "$", paths);
	return paths;
}

function visitContainers(value: JsonValue, path: string, paths: Set<string>) {
	if (!isJsonContainer(value)) return;
	paths.add(path);
	const array = Array.isArray(value);
	for (const [key, child] of Object.entries(value)) {
		visitContainers(child as JsonValue, childPath(path, key, array), paths);
	}
}

function isJsonContainer(
	value: JsonValue,
): value is JsonValue[] | { [key: string]: JsonValue } {
	return typeof value === "object" && value !== null;
}

function childPath(parent: string, key: string, array: boolean): string {
	if (array) return `${parent}[${key}]`;
	return /^[A-Za-z_$][\w$]*$/.test(key)
		? `${parent}.${key}`
		: `${parent}[${JSON.stringify(key)}]`;
}

function readablePath(path: string): string {
	return path === "$" ? "root" : path;
}

function nodeIndent(depth: number) {
	return { paddingInlineStart: `${depth * 20}px` };
}

function guidePosition(depth: number) {
	return { insetInlineStart: `${(depth + 1) * 20 + 9}px` };
}
