import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";

// Node 22+ ships an experimental `localStorage` global that vitest 4 surfaces
// via --localstorage-file (no path → getItem is undefined). It shadows jsdom's
// implementation. Install a plain in-memory Storage so module-init reads work
// regardless of which global wins.
function installLocalStorageShim() {
	const store = new Map<string, string>();
	const shim: Storage = {
		get length() {
			return store.size;
		},
		clear: () => store.clear(),
		getItem: (k) => (store.has(k) ? (store.get(k) as string) : null),
		setItem: (k, v) => {
			store.set(k, String(v));
		},
		removeItem: (k) => {
			store.delete(k);
		},
		key: (i) => Array.from(store.keys())[i] ?? null,
	};
	Object.defineProperty(window, "localStorage", {
		configurable: true,
		writable: true,
		value: shim,
	});
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		writable: true,
		value: shim,
	});
}
installLocalStorageShim();

// jsdom doesn't implement matchMedia; useStore reads it at module init for the
// dark-mode default, so stub it before any import pulls the store in.
if (!window.matchMedia) {
	Object.defineProperty(window, "matchMedia", {
		writable: true,
		value: vi.fn().mockImplementation((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		})),
	});
}

// localStorage is jsdom-provided but persists across test files; wipe between
// tests so useStore module-init reads a clean slate on dynamic re-imports.
beforeEach(() => {
	localStorage.clear();
});

afterEach(() => {
	vi.restoreAllMocks();
});
