/**
 * What an MCP Apps host may withhold from the view, restored before any
 * other module of the reader runs:
 * - web storage, denied in an opaque-origin sandbox (reading `localStorage`
 *   throws): replaced by one held in memory for the life of the view;
 * - `crypto.randomUUID`, absent outside a secure context: built from
 *   `crypto.getRandomValues`.
 */

function memoryStorage(): Storage {
	const values = new Map<string, string>();
	return {
		get length() {
			return values.size;
		},
		clear: () => values.clear(),
		getItem: (key) => values.get(key) ?? null,
		key: (index) => [...values.keys()][index] ?? null,
		removeItem: (key) => {
			values.delete(key);
		},
		setItem: (key, value) => {
			values.set(key, String(value));
		},
	};
}

for (const name of ["localStorage", "sessionStorage"] as const) {
	try {
		void window[name].length;
	} catch {
		Object.defineProperty(window, name, {
			value: memoryStorage(),
			configurable: true,
		});
	}
}

if (typeof crypto.randomUUID !== "function") {
	Object.defineProperty(crypto, "randomUUID", {
		configurable: true,
		value: () => {
			const bytes = crypto.getRandomValues(new Uint8Array(16));
			bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
			bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
			const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
			return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
		},
	});
}
