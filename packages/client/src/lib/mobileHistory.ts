import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

type Shell = Record<string, unknown>;
type Snapshot = {
	shell: Shell;
	local: Record<string, unknown>;
	scroll: Record<string, [number, number]>;
};
type Entry = {
	version: 1;
	session: string;
	index: number;
	snapshot: Snapshot;
	key: string;
};
type Adapter = {
	read: () => Shell;
	restore: (state: Shell) => void;
	subscribe: (listener: () => void) => () => void;
};
const FIELD = "maketMobileNavigation";
const values = new Map<string, unknown>();
const navigationKeys = new Map<string, unknown>();
const listeners = new Set<() => void>();
const files = new Map<string, File>();
const entries = new Map<number, Entry>();
let adapter: Adapter | null = null;
let entry: Entry | null = null;
let restoring = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let contextTimer: ReturnType<typeof setTimeout> | undefined;
let pending = false;
let override: Shell = {};
let returning = false;
let expectedDocument: unknown = null;
const selectors = [
	"[data-mobile-explorer-scroll]",
	"[data-messages-scroll]",
	"[data-mobile-photos-list]",
	"[data-settings-scroll-region]",
	"[data-reading-workspace]",
];
const notify = () => {
	for (const listener of listeners) listener();
};
function encode(value: unknown): unknown {
	if (!(value instanceof File)) return value;
	const id = `${value.name}/${value.lastModified}/${value.size}`;
	files.set(id, value);
	return { mobileFile: id };
}
function decode(value: unknown): unknown {
	return value && typeof value === "object" && "mobileFile" in value
		? (files.get(String(value.mobileFile)) ?? null)
		: value;
}
function snapshot(): Snapshot {
	const scroll: Snapshot["scroll"] = {};
	for (const selector of selectors) {
		const element = document.querySelector<HTMLElement>(selector);
		if (element?.getClientRects().length)
			scroll[selector] = [element.scrollLeft, element.scrollTop];
	}
	return {
		shell: adapter?.read() ?? {},
		local: Object.fromEntries(
			[...values].map(([key, value]) => [key, encode(value)]),
		),
		scroll,
	};
}
function navigationKey(next: Snapshot): string {
	const s = next.shell;
	return JSON.stringify({
		view: s.settingsOpen
			? "settings"
			: s.libraryOpen
				? s.libraryView
				: "reader",
		document: !s.libraryOpen && !s.settingsOpen ? s.focusedDocName : null,
		anchor: s.messageAnchor,
		local: [...navigationKeys.keys()]
			.sort()
			.map((key) => [key, next.local[key] ?? navigationKeys.get(key)]),
	});
}
function write(next: Entry, push: boolean) {
	entry = next;
	entries.set(next.index, next);
	const state = { ...history.state, [FIELD]: next };
	if (push) history.pushState(state, "");
	else history.replaceState(state, "");
}
function refresh() {
	if (!adapter || !entry || restoring || pending) return;
	const next = snapshot();
	if (expectedDocument) {
		if (next.shell.focusedDocName === expectedDocument) expectedDocument = null;
		else next.shell.focusedDocName = expectedDocument;
	}
	write({ ...entry, snapshot: next, key: navigationKey(next) }, false);
}
function commit() {
	timer = undefined;
	if (!adapter || !entry || restoring) {
		pending = false;
		override = {};
		return;
	}
	const next = snapshot();
	next.shell = { ...next.shell, ...override };
	pending = false;
	override = {};
	const key = navigationKey(next);
	if (key === entry.key) {
		write({ ...entry, snapshot: next }, false);
		return;
	}
	const currentIndex = entry.index;
	const previous = returning
		? ([...entries.values()]
				.filter(
					(candidate) =>
						candidate.index < currentIndex &&
						navigationKey(candidate.snapshot) === key,
				)
				.sort((a, b) => b.index - a.index)[0] ?? entries.get(entry.index - 1))
		: undefined;
	returning = false;
	if (previous) {
		const held = { ...entry.snapshot, local: { ...entry.snapshot.local } };
		for (const [name, value] of Object.entries(next.local))
			if (!navigationKeys.has(name)) held.local[name] = value;
		write({ ...entry, snapshot: held }, false);
		history.go(previous.index - entry.index);
		return;
	}
	for (const index of entries.keys())
		if (index > entry.index) entries.delete(index);
	write(
		{
			version: 1,
			session: entry.session,
			index: entry.index + 1,
			snapshot: next,
			key,
		},
		true,
	);
}
/** Called by UI navigation commands, never by data/WS update handlers. */
export function beginMobileNavigation(shellOverride: Shell = {}) {
	if (!adapter || restoring) return;
	if (!pending) {
		refresh();
		returning = false;
	}
	pending = true;
	override = { ...override, ...shellOverride };
	if (shellOverride.focusedDocName) {
		expectedDocument = shellOverride.focusedDocName;
		returning = false;
	}
	if (timer === undefined) timer = setTimeout(commit, 0);
}
export function beginMobileReturn() {
	const alreadyPending = pending;
	beginMobileNavigation();
	if (!alreadyPending) returning = true;
}
export function isRestoringMobileNavigation() {
	return restoring;
}
function apply(next: Entry) {
	if (!adapter) return;
	restoring = true;
	returning = false;
	expectedDocument = next.snapshot.shell.focusedDocName;
	pending = false;
	override = {};
	clearTimeout(timer);
	timer = undefined;
	entry = next;
	entries.set(next.index, next);
	values.clear();
	for (const [key, value] of Object.entries(next.snapshot.local))
		values.set(key, decode(value));
	notify();
	adapter.restore(next.snapshot.shell);
	expectedDocument = adapter.read().focusedDocName;
	requestAnimationFrame(() =>
		requestAnimationFrame(() => {
			for (const [selector, position] of Object.entries(next.snapshot.scroll)) {
				const element = document.querySelector<HTMLElement>(selector);
				if (element) element.scrollTo(position[0], position[1]);
			}
			restoring = false;
		}),
	);
}
export function installMobileHistory(nextAdapter: Adapter): () => void {
	adapter = nextAdapter;
	const held = history.state?.[FIELD] as Entry | undefined;
	if (held?.version === 1 && held.snapshot && typeof held.session === "string")
		apply(held);
	else {
		const initial = snapshot();
		write(
			{
				version: 1,
				session: crypto.randomUUID(),
				index: 0,
				snapshot: initial,
				key: navigationKey(initial),
			},
			false,
		);
	}
	const onPop = (event: PopStateEvent) => {
		const next = event.state?.[FIELD] as Entry | undefined;
		if (next?.version === 1 && next.session === entry?.session) apply(next);
	};
	const onScroll = () => {
		if (!pending && !restoring) {
			clearTimeout(contextTimer);
			contextTimer = setTimeout(refresh, 100);
		}
	};
	const unsubscribe = nextAdapter.subscribe(() => {
		if (!pending && !restoring) queueMicrotask(refresh);
	});
	notify();
	window.addEventListener("popstate", onPop);
	document.addEventListener("scroll", onScroll, true);
	return () => {
		refresh();
		unsubscribe();
		window.removeEventListener("popstate", onPop);
		document.removeEventListener("scroll", onScroll, true);
		clearTimeout(timer);
		clearTimeout(contextTimer);
		timer = undefined;
		adapter = null;
		notify();
		pending = false;
		restoring = false;
	};
}
/** UI state only; replacing context (typing/scroll) never adds a history step. */
export function useMobileHistoryState<T>(
	key: string,
	initial: T,
	mode: "navigate" | "context" | "destination" = "navigate",
): [T, (value: T | ((previous: T) => T)) => void] {
	if (!values.has(key)) values.set(key, initial);
	if (mode !== "context") navigationKeys.set(key, initial);
	const subscribe = useCallback((listener: () => void) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	}, []);
	const read = useCallback(
		() => (values.has(key) ? (values.get(key) as T) : initial),
		[key, initial],
	);
	const value = useSyncExternalStore(subscribe, read);
	const active = useSyncExternalStore(subscribe, () => adapter !== null);
	const [fallback, setFallback] = useState({ key, value: initial });
	useEffect(() => {
		if (active) setFallback({ key, value });
		else
			setFallback((previous) =>
				previous.key === key ? previous : { key, value: initial },
			);
	}, [active, initial, key, value]);
	const set = useCallback(
		(next: T | ((previous: T) => T)) => {
			if (!adapter) {
				setFallback((previous) => {
					const old = previous.key === key ? previous.value : initial;
					return {
						key,
						value:
							typeof next === "function" ? (next as (old: T) => T)(old) : next,
					};
				});
				return;
			}
			const old = (values.has(key) ? values.get(key) : initial) as T;
			const resolved =
				typeof next === "function" ? (next as (old: T) => T)(old) : next;
			if (Object.is(old, resolved)) return;
			if (mode !== "context") {
				if (mode === "navigate" && Object.is(resolved, initial))
					beginMobileReturn();
				else beginMobileNavigation();
			}
			values.set(key, resolved);
			notify();
			if (mode === "context") queueMicrotask(refresh);
		},
		[key, initial, mode],
	);
	return [
		active ? value : fallback.key === key ? fallback.value : initial,
		set,
	];
}
