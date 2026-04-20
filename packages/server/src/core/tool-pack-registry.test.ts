import { asFunction, asValue } from "awilix";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolHandler } from "./container.js";
import type { ToolPack } from "./tool-pack.js";
import { buildToolPackContainer } from "./tool-pack-registry.js";

function makeTool(name: string): ToolHandler {
	return {
		metadata: {
			name,
			description: `desc-${name}`,
			schema: z.object({}),
		},
		handler: async () => ({ content: [{ type: "text", text: name }] }),
	};
}

describe("buildToolPackContainer", () => {
	it("registers plugins in manifest order and resolves services", () => {
		const a: ToolPack = {
			id: "a",
			name: "A",
			declaresTools: [],
			register(c) {
				c.register({ alpha: asValue("from-a") });
			},
		};
		const b: ToolPack = {
			id: "b",
			name: "B",
			requires: ["alpha"],
			declaresTools: [],
			register(c) {
				c.register({ beta: asValue("from-b") });
			},
		};

		const { container, loadedPacks } = buildToolPackContainer(
			{ packs: { a: {}, b: {} } },
			[a, b],
		);

		expect(loadedPacks).toEqual(["a", "b"]);
		expect(container.resolve("alpha")).toBe("from-a");
		expect(container.resolve("beta")).toBe("from-b");
	});

	it("throws when a plugin requires a missing registration", () => {
		const p: ToolPack = {
			id: "needs-db",
			name: "needs-db",
			requires: ["store"],
			declaresTools: [],
			register() {},
		};
		expect(() =>
			buildToolPackContainer({ packs: { "needs-db": {} } }, [p]),
		).toThrow(/requires "store"/);
	});

	it("throws on duplicate plugin id", () => {
		const p1: ToolPack = {
			id: "dup",
			name: "1",
			declaresTools: [],
			register() {},
		};
		const p2: ToolPack = {
			id: "dup",
			name: "2",
			declaresTools: [],
			register() {},
		};
		expect(() =>
			buildToolPackContainer({ packs: { dup: {} } }, [p1, p2]),
		).toThrow(/Duplicate tool pack id/);
	});

	it("throws when manifest references an unknown plugin", () => {
		expect(() => buildToolPackContainer({ packs: { ghost: {} } }, [])).toThrow(
			/Unknown tool pack: ghost/,
		);
	});

	it("throws when a declared tool fails to register", () => {
		// Typo in the Awilix key: "fooTol" does not end with "Tool" so it is
		// skipped by the registry scan, but the pack declared "foo".
		const p: ToolPack = {
			id: "typo",
			name: "typo",
			declaresTools: ["foo"],
			register(c) {
				c.register({
					fooTol: asFunction(() => makeTool("foo")).singleton(),
				});
			},
		};
		expect(() => buildToolPackContainer({ packs: { typo: {} } }, [p])).toThrow(
			/did not register.*foo/,
		);
	});

	it("scans *Tool registrations and builds the tool registry", () => {
		const plugin: ToolPack = {
			id: "tools",
			name: "tools",
			declaresTools: ["foo", "bar"],
			register(c) {
				c.register({
					fooTool: asFunction(() => makeTool("foo")).singleton(),
					barTool: asFunction(() => makeTool("bar")).singleton(),
					notATool: asValue({ metadata: { name: "nope" } }), // missing handler
					helperValue: asValue(42), // no "Tool" suffix → ignored
				});
			},
		};

		const { container } = buildToolPackContainer({ packs: { tools: {} } }, [
			plugin,
		]);
		const registry =
			container.resolve<Map<string, ToolHandler>>("toolRegistry");

		expect([...registry.keys()].sort()).toEqual(["bar", "foo"]);
		expect(registry.get("foo")?.metadata.description).toBe("desc-foo");
	});

	it("passes plugin config to register()", () => {
		let received: unknown;
		const p: ToolPack = {
			id: "cfg",
			name: "cfg",
			declaresTools: [],
			register(_c, cfg) {
				received = cfg;
			},
		};
		buildToolPackContainer({ packs: { cfg: { port: 3333 } } }, [p]);
		expect(received).toEqual({ port: 3333 });
	});
});
