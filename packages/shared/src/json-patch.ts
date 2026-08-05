export type JsonPatchOperation =
	| { op: "add"; path: string; value: unknown }
	| { op: "remove"; path: string }
	| { op: "replace"; path: string; value: unknown }
	| { op: "move"; from: string; path: string }
	| { op: "copy"; from: string; path: string }
	| { op: "test"; path: string; value: unknown };

const unsafePointerSegments = new Set([
	"__proto__",
	"prototype",
	"constructor",
]);

/** Decode an RFC 6901 JSON Pointer into safe property segments. */
export function parseJsonPointer(pointer: string): string[] {
	if (pointer === "") return [];
	if (!pointer.startsWith("/")) {
		throw new Error(
			`Invalid JSON Pointer "${pointer}": expected a leading slash.`,
		);
	}
	return pointer
		.slice(1)
		.split("/")
		.map((segment) => {
			if (/~(?:[^01]|$)/.test(segment)) {
				throw new Error(`Invalid JSON Pointer escape in "${pointer}".`);
			}
			const decoded = segment.replaceAll("~1", "/").replaceAll("~0", "~");
			if (unsafePointerSegments.has(decoded)) {
				throw new Error(`Unsafe JSON Pointer segment "${decoded}".`);
			}
			return decoded;
		});
}

export function escapeJsonPointerSegment(segment: string): string {
	return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function appendJsonPointer(
	pointer: string,
	segment: string | number,
): string {
	return `${pointer}/${escapeJsonPointerSegment(String(segment))}`;
}

export function readJsonPointer(value: unknown, pointer: string): unknown {
	let current = value;
	for (const segment of parseJsonPointer(pointer)) {
		current = readChild(current, segment, pointer);
	}
	return current;
}

/** Apply standard RFC 6902 operations without mutating the input value. */
export function applyJsonPatch<T>(
	value: T,
	operations: JsonPatchOperation[],
): T {
	let result: unknown = cloneJson(value);
	for (const operation of operations)
		result = applyOperation(result, operation);
	return result as T;
}

export function isTerminalJsonValue(
	value: unknown,
): value is null | string | number | boolean {
	return (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	);
}

export function jsonPointersIntersect(left: string, right: string): boolean {
	const leftSegments = parseJsonPointer(left);
	const rightSegments = parseJsonPointer(right);
	const common = Math.min(leftSegments.length, rightSegments.length);
	for (let index = 0; index < common; index += 1) {
		if (leftSegments[index] !== rightSegments[index]) return false;
	}
	return true;
}

function applyOperation(
	value: unknown,
	operation: JsonPatchOperation,
): unknown {
	switch (operation.op) {
		case "add":
			return addAtPointer(value, operation.path, cloneJson(operation.value));
		case "remove":
			return removeAtPointer(value, operation.path).value;
		case "replace":
			readJsonPointer(value, operation.path);
			return replaceAtPointer(
				value,
				operation.path,
				cloneJson(operation.value),
			);
		case "move": {
			if (
				operation.path !== operation.from &&
				isStrictDescendant(operation.path, operation.from)
			) {
				throw new Error("A JSON Patch move cannot move a value into itself.");
			}
			const removed = removeAtPointer(value, operation.from);
			return addAtPointer(removed.value, operation.path, removed.removed);
		}
		case "copy":
			return addAtPointer(
				value,
				operation.path,
				cloneJson(readJsonPointer(value, operation.from)),
			);
		case "test":
			if (!jsonEqual(readJsonPointer(value, operation.path), operation.value)) {
				throw new Error(`JSON Patch test failed at "${operation.path}".`);
			}
			return value;
	}
}

function addAtPointer(value: unknown, pointer: string, next: unknown): unknown {
	if (pointer === "") return next;
	const { parent, segment } = parentAtPointer(value, pointer);
	if (Array.isArray(parent)) {
		if (segment === "-") {
			parent.push(next);
			return value;
		}
		const index = arrayIndex(segment, pointer);
		if (index > parent.length) {
			throw new Error(`JSON Pointer index is out of bounds: "${pointer}".`);
		}
		parent.splice(index, 0, next);
		return value;
	}
	if (!isRecord(parent)) throw nonContainerError(pointer);
	parent[segment] = next;
	return value;
}

function replaceAtPointer(
	value: unknown,
	pointer: string,
	next: unknown,
): unknown {
	if (pointer === "") return next;
	const { parent, segment } = parentAtPointer(value, pointer);
	if (Array.isArray(parent)) {
		const index = arrayIndex(segment, pointer);
		if (index >= parent.length) {
			throw new Error(`JSON Pointer index is out of bounds: "${pointer}".`);
		}
		parent[index] = next;
		return value;
	}
	if (!isRecord(parent) || !Object.hasOwn(parent, segment)) {
		throw new Error(`JSON Pointer target does not exist: "${pointer}".`);
	}
	parent[segment] = next;
	return value;
}

function removeAtPointer(
	value: unknown,
	pointer: string,
): { value: unknown; removed: unknown } {
	if (pointer === "") {
		throw new Error("Removing the document-state root is not supported.");
	}
	const { parent, segment } = parentAtPointer(value, pointer);
	if (Array.isArray(parent)) {
		const index = arrayIndex(segment, pointer);
		if (index >= parent.length) {
			throw new Error(`JSON Pointer index is out of bounds: "${pointer}".`);
		}
		const [removed] = parent.splice(index, 1);
		return { value, removed };
	}
	if (!isRecord(parent) || !Object.hasOwn(parent, segment)) {
		throw new Error(`JSON Pointer target does not exist: "${pointer}".`);
	}
	const removed = parent[segment];
	delete parent[segment];
	return { value, removed };
}

function parentAtPointer(
	value: unknown,
	pointer: string,
): { parent: unknown; segment: string } {
	const segments = parseJsonPointer(pointer);
	const segment = segments.pop();
	if (segment === undefined) {
		throw new Error("The JSON Pointer root has no parent.");
	}
	let parent = value;
	for (const part of segments) parent = readChild(parent, part, pointer);
	return { parent, segment };
}

function readChild(value: unknown, segment: string, pointer: string): unknown {
	if (Array.isArray(value)) {
		const index = arrayIndex(segment, pointer);
		if (index >= value.length) {
			throw new Error(`JSON Pointer target does not exist: "${pointer}".`);
		}
		return value[index];
	}
	if (!isRecord(value) || !Object.hasOwn(value, segment)) {
		throw new Error(`JSON Pointer target does not exist: "${pointer}".`);
	}
	return value[segment];
}

function arrayIndex(segment: string, pointer: string): number {
	if (!/^(0|[1-9]\d*)$/.test(segment)) {
		throw new Error(`Invalid array index in JSON Pointer "${pointer}".`);
	}
	return Number(segment);
}

function isStrictDescendant(pointer: string, ancestor: string): boolean {
	const child = parseJsonPointer(pointer);
	const parent = parseJsonPointer(ancestor);
	return (
		child.length > parent.length &&
		parent.every((segment, index) => child[index] === segment)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
	if (value === undefined) {
		throw new Error("JSON Patch values must be valid JSON values.");
	}
	try {
		return JSON.parse(JSON.stringify(value)) as T;
	} catch {
		throw new Error("JSON Patch values must be valid JSON values.");
	}
}

function jsonEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (Array.isArray(left) && Array.isArray(right)) {
		return (
			left.length === right.length &&
			left.every((value, index) => jsonEqual(value, right[index]))
		);
	}
	if (isRecord(left) && isRecord(right)) {
		const leftKeys = Object.keys(left).sort();
		const rightKeys = Object.keys(right).sort();
		return (
			jsonEqual(leftKeys, rightKeys) &&
			leftKeys.every((key) => jsonEqual(left[key], right[key]))
		);
	}
	return false;
}

function nonContainerError(pointer: string): Error {
	return new Error(
		`JSON Pointer parent is not an object or array: "${pointer}".`,
	);
}
