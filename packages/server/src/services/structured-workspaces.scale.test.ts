import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { structuredWorkspaceMaxBatch } from "@maket/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppContainer } from "../bootstrap.js";
import { createConfig } from "./config.js";
import type { Documents } from "./documents.js";
import { createSQLiteStore, type Store } from "./store.js";
import {
	isStructuredWorkspaceRefusal,
	type StructuredWorkspaces,
} from "./structured-workspaces.js";

const browserPool = {
	async get(): Promise<never> {
		throw new Error("Browser rendering is not used by this test");
	},
	async dispose() {},
};

const ITEMS = 2000;

const schema = {
	type: "object",
	properties: {
		code: { type: "string" },
		title: { type: "string" },
		status: { type: "string", enum: ["todo", "done"] },
	},
	required: ["code", "title", "status"],
	additionalProperties: false,
};

let tmp: string;
let store: Store;
let workspaces: StructuredWorkspaces;
let workspaceId: string;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "maket-scale-"));
	store = createSQLiteStore(":memory:");
	const container = createAppContainer({
		browserPool,
		ensure: false,
		store,
		config: createConfig({
			env: { MAKET_DATA_DIR: tmp },
			homedir: () => "/nowhere",
		}),
	});
	container.resolve<Documents>("documents").loadAll();
	workspaces = container.resolve<StructuredWorkspaces>("structuredWorkspaces");
	workspaceId = workspaces.create({
		name: "Large",
		dataSchema: schema,
		representationSchema: {
			version: 1,
			collections: { items: { name: "Items", identity: "/code" } },
		},
	}).id;
	store.transaction(() => {
		for (let index = 1; index <= ITEMS; index += 1) {
			const code = `item-${String(index).padStart(4, "0")}`;
			store.addStructuredWorkspaceItem(workspaceId, {
				id: code,
				collectionId: "items",
				bindingId: "item",
				documentId: `document-${code}`,
				documentName: `Large ${code}`,
				data: { code, title: `Item ${index}`, status: "todo" },
			});
		}
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	store.close();
	rmSync(tmp, { recursive: true, force: true });
});

/** A full read of the 2 000 items by batches: each query asks one row more
 * than the batch to know whether another batch follows. */
const fullRead = [
	structuredWorkspaceMaxBatch + 1,
	structuredWorkspaceMaxBatch + 1,
	structuredWorkspaceMaxBatch + 1,
	structuredWorkspaceMaxBatch,
];

/** The item rows each store read loads while `run` runs. */
function rowReads(run: () => void): { calls: number[]; single: number } {
	const batch = store.loadStructuredWorkspaceItemBatch.bind(store);
	const calls: number[] = [];
	const batches = vi
		.spyOn(store, "loadStructuredWorkspaceItemBatch")
		.mockImplementation((query) => {
			const result = batch(query);
			calls.push(result.rows.length);
			return result;
		});
	const single = vi.spyOn(store, "loadStructuredWorkspaceItem");
	try {
		run();
		return { calls, single: single.mock.calls.length };
	} finally {
		batches.mockRestore();
		single.mockRestore();
	}
}

describe("Structured Workspaces over 2 000 items", () => {
	it("lists views from the definition and the counts, without reading an item row", () => {
		const reads = rowReads(() => {
			const [view] = workspaces.listViews();
			expect(view?.itemCounts).toEqual({ items: ITEMS });
			expect(view).not.toHaveProperty("items");
		});
		expect(reads).toEqual({ calls: [], single: 0 });
		expect(store.loadStructuredWorkspace(workspaceId)).not.toHaveProperty(
			"items",
		);
	});

	it("checks every item by batches of at most structuredWorkspaceMaxBatch rows", () => {
		store.putStructuredWorkspaceItem(workspaceId, "item-1500", 1, {
			code: "item-1500",
			title: "Item 1500",
			status: "lost",
		});
		let findings: ReturnType<StructuredWorkspaces["check"]>["findings"] = [];
		const reads = rowReads(() => {
			findings = workspaces.check(workspaceId).findings;
		});
		expect(findings).toEqual([
			expect.objectContaining({ path: 'item "item-1500" /status' }),
		]);
		expect(reads).toEqual({ calls: fullRead, single: 0 });
	});

	it("validates a new definition by batches, every row when it holds, and stops after the first breaches it reports", () => {
		const workspace = workspaces.get(workspaceId);
		if (!workspace) throw new Error("Workspace missing.");
		const accepted = rowReads(() => {
			workspaces.updateDefinition({
				workspace: workspaceId,
				expectedRevision: workspace.revision,
				dataSchema: {
					...schema,
					properties: { ...schema.properties, note: { type: "string" } },
				},
			});
		});
		expect(accepted.calls).toEqual(fullRead);

		const updated = workspaces.get(workspaceId);
		if (!updated) throw new Error("Workspace missing.");
		let refusal: unknown;
		const refused = rowReads(() => {
			try {
				workspaces.updateDefinition({
					workspace: workspaceId,
					expectedRevision: updated.revision,
					dataSchema: {
						...schema,
						properties: { ...schema.properties, owner: { type: "string" } },
						required: [...schema.required, "owner"],
					},
				});
			} catch (error) {
				refusal = error;
			}
		});
		if (!isStructuredWorkspaceRefusal(refusal)) throw new Error("Not refused.");
		expect(refusal.findings).toHaveLength(20);
		expect(refusal.message).toContain("20 or more item breach(es)");
		expect(refused.calls).toEqual([structuredWorkspaceMaxBatch + 1]);
		expect(workspaces.get(workspaceId)?.revision).toBe(updated.revision);
	});
});
